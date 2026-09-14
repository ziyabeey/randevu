import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260914110200_f10_customer_authority_repair.sql', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/CustomersPage.tsx', import.meta.url), 'utf8');
const customerCss = readFileSync(new URL('../src/customers.css', import.meta.url), 'utf8');
const phaseCss = readFileSync(new URL('../src/phase4.css', import.meta.url), 'utf8');
const browserSmoke = readFileSync(new URL('../scripts/browser-smoke.sh', import.meta.url), 'utf8');
const browserAcceptance = readFileSync(new URL('../scripts/browser-f10-customers.mjs', import.meta.url), 'utf8');

await test('F10-05 forward repair closes raw customer-bearing authenticated reads', () => {
  assert.match(migration, /revoke select on table public\.customers from authenticated/i);
  assert.match(migration, /revoke select on table public\.appointments from authenticated/i);
  assert.match(migration, /revoke all on function public\.f10_resolve_or_create_customer[\s\S]*from public, anon, authenticated/i);
});

await test('F10-05 CRM, operator and public writers share canonical customer resolution', () => {
  const calls = migration.match(/f10_resolve_or_create_customer\(/g) ?? [];
  assert.ok(calls.length >= 4, `expected helper declaration plus three writer calls, got ${calls.length}`);
  assert.match(migration, /create or replace function public\.create_business_customer[\s\S]*f10_resolve_or_create_customer/i);
  assert.match(migration, /create or replace function public\.create_appointment[\s\S]*f10_require_standard_session\(\)[\s\S]*f10_resolve_or_create_customer/i);
  assert.match(migration, /create or replace function public\.create_public_appointment[\s\S]*f10_resolve_or_create_customer/i);
});

await test('F10-05 operator booking no longer silently overwrites customer master', () => {
  const operator = migration.match(/create or replace function public\.create_appointment\([\s\S]*?\n\$\$;\n\n-- Public booking/)?.[0] ?? '';
  assert.ok(operator, 'operator create_appointment replacement missing');
  assert.doesNotMatch(operator, /update\s+public\.customers/i);
  assert.match(operator, /customer_name_snapshot/);
  assert.match(operator, /v_customer_name, v_customer_phone, v_customer_email/);
});

await test('F10-05 list and history have exclusive loading error empty success states', () => {
  assert.match(page, /type LoadState = 'idle' \| 'loading' \| 'success' \| 'error'/);
  assert.match(page, /listState === 'error'[\s\S]*customers-error[\s\S]*listError/);
  assert.match(page, /listState === 'success'[\s\S]*Bu aramada müşteri bulunamadı/);
  assert.match(page, /historyState === 'error'[\s\S]*customers-error[\s\S]*historyError/);
  assert.match(page, /historyState === 'success'[\s\S]*Bu müşterinin randevu geçmişi yok/);
});

await test('F10-05 mobile controls and shared navigation preserve touch/focus reachability', () => {
  assert.match(customerCss, /\.customers-shell button \{[\s\S]*min-height: 44px/);
  assert.match(customerCss, /\.customers-form input,[\s\S]*min-height: 44px/);
  assert.match(customerCss, /:focus-visible/);
  assert.match(phaseCss, /\.phase-nav a \{[\s\S]*min-height: 44px/);
  assert.match(phaseCss, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

await test('F10-05 dedicated Chrome acceptance is part of required browser smoke', () => {
  assert.match(browserSmoke, /browser-f10-customers\.mjs/);
  for (const marker of [
    'delayHistoryOnceMs',
    'delayListOnceMs',
    'Müşteri listesi test hatası.',
    'Randevu geçmişi test hatası.',
    'Emulation.setDeviceMetricsOverride',
    'Input.dispatchKeyEvent',
    'recovery UI requested private customer data',
  ]) assert.match(browserAcceptance, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
