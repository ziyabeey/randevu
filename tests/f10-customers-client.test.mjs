import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/CustomersPage.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/customers.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260914110000_f10_customer_records.sql', import.meta.url), 'utf8');

await test('F10-05 customers are a dedicated workspace routed through the shared API client', () => {
  assert.match(main, /const isCustomers = path === '\/customers'/);
  assert.match(main, /isCustomers\s*\? <CustomersPage/);
  assert.match(page, /import \{ api, ApiRequestError \} from '\.\/api'/);
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
});

await test('F10-05 list and history reads are abortable and generation-scoped', () => {
  assert.match(page, /listController\.current\?\.abort\(\)/);
  assert.match(page, /historyController\.current\?\.abort\(\)/);
  assert.match(page, /\+\+listGeneration\.current/);
  assert.match(page, /\+\+historyGeneration\.current/);
  assert.match(page, /tenantGeneration\.current/);
  assert.match(page, /generation !== listGeneration\.current/);
  assert.match(page, /generation !== historyGeneration\.current/);
});

await test('F10-05 tenant switch clears scoped state and hard-navigates only after server selection', () => {
  const switchBody = page.match(/async function switchBusiness[\s\S]*?\n  }\n\n  async function createCustomer/)?.[0] ?? '';
  assert.match(switchBody, /cancelBusinessScopedReads\(\)/);
  assert.match(switchBody, /setCustomers\(\[\]\)/);
  assert.match(switchBody, /setHistory\(\[\]\)/);
  const apiCall = switchBody.indexOf("await api('/api/businesses/select'");
  const navigation = switchBody.indexOf("window.location.assign('/customers')");
  assert.ok(apiCall >= 0 && navigation > apiCall, 'tenant UI must change only after server selection succeeds');
});

await test('F10-05 customer history renders appointment snapshots instead of current master fields', () => {
  assert.match(page, /appointment\.customer_name_snapshot/);
  assert.match(page, /appointment\.service_name_snapshot/);
  assert.match(page, /appointment\.staff_name_snapshot/);
  assert.match(page, /appointment\.price_minor_snapshot/);
  assert.match(migration, /customer_name_snapshot/);
  assert.doesNotMatch(migration, /update\s+public\.appointments[\s\S]*customer_name_snapshot/i);
});

await test('F10-05 Worker authority ignores client business IDs and uses selected membership', () => {
  assert.match(worker, /p_business_id: access\.membership\.business_id/);
  assert.doesNotMatch(worker, /req\.query\('businessId'\)|body\?\.businessId/);
  assert.match(worker, /parsePageLimit/);
  assert.match(worker, /decodePageCursor/);
  assert.match(worker, /pageResult/);
});

await test('F10-05 identity contract never treats a matching name as a customer key', () => {
  assert.match(migration, /CUSTOMER_CONTACT_EXISTS/);
  assert.match(migration, /f10_normalize_customer_phone/);
  assert.match(migration, /f10_normalize_customer_email/);
  const duplicateSection = migration.match(/if exists \([\s\S]*?CUSTOMER_CONTACT_EXISTS/gi)?.join('\n') ?? '';
  assert.doesNotMatch(duplicateSection, /c\.name\s*=/i);
});
