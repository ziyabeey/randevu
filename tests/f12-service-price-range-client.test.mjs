import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/CatalogSettingsPanel.tsx', import.meta.url), 'utf8');
const booking = readFileSync(new URL('../src/BookingPage.tsx', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/catalog-management.ts', import.meta.url), 'utf8');
const bookingWorker = readFileSync(new URL('../worker/bookings.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260915150000_f12_service_price_range.sql', import.meta.url), 'utf8');

test('F12-03 catalog editor carries canonical category/order/range fields', () => {
  for (const token of ['category', 'sortOrder', 'priceType', 'priceMinMinor', 'priceMaxMinor', 'currency']) {
    assert.ok(panel.includes(token), `catalog editor missing ${token}`);
    assert.ok(worker.includes(token), `catalog worker missing ${token}`);
  }
  assert.match(panel, /priceTypeOf\(service\) === 'range'/);
  assert.match(panel, /formatServicePrice/);
});

test('F12-03 operator booking never presents a range lower-bound as a fixed price', () => {
  assert.doesNotMatch(booking, /legacyCreateBookable/);
  assert.match(booking, /catalog\?\.services\.filter\(\(item\) => item\.active\)/);
  assert.match(booking, /item\.price_type === 'range' \? ' · fiyat aralığı'/);
  assert.match(booking, /Kesin tutar adisyonda belirlenir/);
  assert.match(booking, /Fiyat aralıklı hizmetler tahmin olarak gösterilir/);
  assert.match(booking, /priceType === 'fixed'/);
  assert.match(booking, /priceMinMinor/);
  assert.match(booking, /priceMaxMinor/);
  assert.match(bookingWorker, /SERVICE_PRICE_NOT_FINAL/);
});

test('F12-03 money authority remains integer minor-unit on the Worker/DB boundary', () => {
  assert.match(worker, /Number\.isInteger\(value\)/);
  assert.match(worker, /p_price_min_minor: priceMinMinor/);
  assert.match(worker, /p_price_max_minor: priceMaxMinor/);
  assert.match(migration, /price_min_minor integer/);
  assert.match(migration, /price_max_minor integer/);
  assert.match(migration, /revoke all on function public\.f12_price_estimate_internal\(uuid,uuid\[\]\) from public, anon, authenticated/);
});

test('F12-03 public legacy projection and appointment snapshot fail closed for range services', () => {
  assert.match(migration, /sv\.price_type = 'fixed'/);
  assert.match(migration, /SERVICE_PRICE_NOT_FINAL/);
  assert.match(migration, /appointments_f12_fixed_price_guard/);
});