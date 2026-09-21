import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/CustomersPage.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/WorkspaceShell.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/workspace-route.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/customers.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260914110000_f10_customer_records.sql', import.meta.url), 'utf8');
const groupProjection = readFileSync(new URL('../supabase/migrations/20260917160500_f11_group_integration_repair.sql', import.meta.url), 'utf8');
const groupPayload = readFileSync(new URL('../supabase/migrations/20260917133000_f11_multi_service_final_repair.sql', import.meta.url), 'utf8');

await test('F10-05 customers are a dedicated canonical workspace route through the shared shell and API client', () => {
  assert.match(routes, /'\/app\/customers': 'customers'/);
  assert.match(shell, /page === 'customers'\) return <CustomersPage/);
  assert.match(page, /import \{ api, ApiRequestError \} from '\.\/api'/);
  assert.match(page, /useWorkspace/);
  assert.doesNotMatch(page, /\/api\/session/);
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

await test('F10-05 customer selection does not recreate the mount loader or abort its own history read', () => {
  assert.match(page, /const selectedIdRef = useRef<string \| null>\(null\)/);
  assert.match(page, /selectedIdRef\.current = customerId/);
  assert.match(page, /row\.customer_id === selectedIdRef\.current/);
  assert.doesNotMatch(page, /\}, \[selectedId\]\);\n\n  const loadHistory/);
  assert.match(page, /const loadPage = useCallback[\s\S]*?\}, \[cancelBusinessScopedReads, loadCustomers\]\);/);
});

await test('F10-05 tenant switch clears scoped state and delegates selection to the shared shell', () => {
  const switchBody = page.match(/async function switchBusiness[\s\S]*?\n  }\n\n  async function createCustomer/)?.[0] ?? '';
  assert.match(switchBody, /cancelBusinessScopedReads\(\)/);
  assert.match(switchBody, /setCustomers\(\[\]\)/);
  assert.match(switchBody, /setHistory\(\[\]\)/);
  assert.match(switchBody, /await selectBusiness\(businessId\)/);
  assert.doesNotMatch(switchBody, /\/api\/businesses\/select|window\.location/);
});

await test('F10-05 customer history renders frozen booking snapshots instead of current master fields', () => {
  assert.match(page, /booking\.customerName/);
  assert.match(page, /line\.serviceName/);
  assert.match(page, /line\.staffName/);
  assert.match(page, /bookingEstimate\(booking\)/);
  assert.match(groupProjection, /v_anchor\.customer_name_snapshot/);
  assert.match(groupPayload, /a\.service_name_snapshot/);
  assert.match(groupPayload, /a\.staff_name_snapshot/);
  assert.match(groupPayload, /a\.price_min_minor_snapshot/);
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