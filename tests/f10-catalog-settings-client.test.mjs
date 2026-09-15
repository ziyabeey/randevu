import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/AvailabilityPage.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/CatalogSettingsPanel.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260914111500_f10_catalog_hours_management.sql', import.meta.url), 'utf8');
const staleMigration = readFileSync(new URL('../supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql', import.meta.url), 'utf8');
const snapshotMigration = readFileSync(new URL('../supabase/migrations/20260914111800_f10_catalog_snapshot_session_guard.sql', import.meta.url), 'utf8');
const readSessionMigration = readFileSync(new URL('../supabase/migrations/20260914111900_f10_catalog_read_session_guard.sql', import.meta.url), 'utf8');
const index = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const catalogWorker = readFileSync(new URL('../worker/catalog-management.ts', import.meta.url), 'utf8');
const availabilityWorker = readFileSync(new URL('../worker/availability.ts', import.meta.url), 'utf8');

await test('F10-04 reuses existing /availability route and exposes one guarded catalog mutation authority', () => {
  assert.match(index, /import catalogManagement from '\.\/catalog-management\.ts'/);
  assert.match(index, /app\.route\('\/api', catalogManagement\)/);
  assert.doesNotMatch(index, /app\.post\('\/api\/services'/);
  assert.doesNotMatch(index, /rest\/v1\/staff_services\?on_conflict/);
  assert.doesNotMatch(page, /window\.location|history\.pushState/);
});

await test('F10-04 settings reads cancel stale tenant responses and verify returned business authority', () => {
  assert.match(page, /requestController\.current\?\.abort\(\)/);
  assert.match(page, /const generation = \+\+requestGeneration\.current/);
  assert.match(page, /generation !== requestGeneration\.current/);
  assert.match(page, /nextCatalog\.membership\.business_id !== nextSession\.activeBusinessId/);
  assert.match(page, /nextSetup\.membership\.business_id !== nextSession\.activeBusinessId/);
  assert.match(page, /signal: controller\.signal/);
});

await test('F10-04 service editor preserves fixed-price minor units, duration and both buffers', () => {
  assert.match(panel, /Math\.round\(amount \* 100\)/);
  for (const field of ['priceMinor', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes']) {
    assert.ok(panel.includes(field), `missing service field ${field}`);
  }
  assert.ok(panel.includes('expectedUpdatedAt: service.updated_at'));
  assert.match(panel, /Intl\.NumberFormat\('tr-TR'/);
});

await test('F10-04 mutation success is distinct from authoritative refresh success', () => {
  assert.match(panel, /await action\(\);[\s\S]*const refreshed = await reload\(\);[\s\S]*if \(refreshed\) setNotice\(success\)/);
  assert.doesNotMatch(panel, /Güncel görünüm yüklenemedi; sayfayı yenileyerek kontrol edin/);
  assert.equal((panel.match(/if \(saved\) form\.reset\(\);/g) ?? []).length, 2);
  assert.match(page, /const \[loadState, setLoadState\] = useState<LoadState>\('loading'\)/);
  assert.match(page, /loadState === 'error'/);
  assert.match(page, /Tekrar yükle/);
  assert.match(page, /loadState === 'no-workspace'/);
});

await test('F10-04 stale writes reload authoritative state without retrying the mutation', () => {
  assert.match(panel, /error instanceof ApiRequestError && error\.status === 409 && error\.code === 'STALE_WRITE'/);
  assert.match(panel, /const refreshed = await reload\(\)/);
  assert.match(panel, /Güncel bilgiler yeniden yüklendi; yaptığınız değişiklik uygulanmadı/);
  assert.match(panel, /key=\{`\$\{service\.id\}:\$\{service\.updated_at\}`\}/);
  assert.match(panel, /key=\{`\$\{person\.id\}:\$\{person\.updated_at\}`\}/);
  assert.match(page, /error instanceof ApiRequestError && error\.status === 409 && error\.code === 'STALE_WRITE'/);
});

await test('F10-04 archive semantics are active=false and historical rows are described as preserved', () => {
  assert.ok(panel.includes('Hizmet arşivlendi. Geçmiş randevular değişmedi.'));
  assert.ok(panel.includes('Personel arşivlendi. Geçmiş randevular değişmedi.'));
  assert.doesNotMatch(panel, /method:\s*'DELETE'[\s\S]{0,120}\/(?:api\/)?(?:services|staff)/i);
  assert.match(migration, /active = v_active/);
});

await test('F10-04 weekly hours carry expected snapshots and explain effect on future availability', () => {
  assert.ok(page.includes('JSON.stringify({ intervals, expectedIntervals })'));
  assert.ok(page.includes('Mevcut randevular değişmedi'));
  assert.ok(page.includes('yeni uygunlukları etkiler'));
  assert.match(staleMigration, /p_expected_intervals is null and v_current <> '\[\]'::jsonb/);
  assert.match(staleMigration, /raise exception 'STALE_WRITE'/);
});

await test('F10-04 existing catalog rows require optimistic proof at Worker and direct-RPC boundaries', () => {
  assert.ok(catalogWorker.includes('validExpected(body.expectedUpdatedAt)'));
  assert.match(staleMigration, /p_expected_updated_at is null[\s\S]*raise exception 'STALE_WRITE'/);
  assert.match(staleMigration, /v_exists and \([\s\S]*p_expected_updated_at is null/);
  assert.ok(catalogWorker.includes('rest/v1/staff_services?'));
});

await test('F10-04 bounded catalog snapshot rejects recovery sessions at the DB boundary', () => {
  assert.match(snapshotMigration, /perform public\.f10_require_standard_session\(\)/);
  assert.match(snapshotMigration, /revoke all on function public\.get_catalog_snapshot\(uuid\)/);
  assert.match(snapshotMigration, /grant execute on function public\.get_catalog_snapshot\(uuid\)[\s\S]*to authenticated/);
});

await test('F10-04 raw catalog/hour reads require both Membership and standard session', () => {
  assert.match(readSessionMigration, /create or replace function public\.f10_has_standard_session\(\)/);
  assert.match(readSessionMigration, /perform public\.f10_require_standard_session\(\)/);
  for (const policy of [
    'services_select_member', 'staff_select_member', 'staff_services_select_member',
    'business_hours_select_member', 'staff_hours_select_member', 'availability_blocks_select_member',
  ]) assert.ok(readSessionMigration.includes(`create policy ${policy}`), `missing guarded policy ${policy}`);
  assert.equal((readSessionMigration.match(/public\.f10_has_standard_session\(\)/g) ?? []).length >= 7, true);
  assert.match(readSessionMigration, /revoke all on function public\.f10_has_standard_session\(\) from public, anon, authenticated/);
});

await test('F10-04 legacy setup compatibility captures server-side hour versions instead of blind null writes', () => {
  assert.ok(availabilityWorker.includes('rest/v1/business_hours?'));
  assert.ok(availabilityWorker.includes('rest/v1/staff_hours?'));
  assert.ok(availabilityWorker.includes('p_expected_intervals: expectedIntervals'));
});

await test('F10-04 user surface and management errors avoid internal product terminology', () => {
  assert.doesNotMatch(page, /FAZ\s*4|tenant|RPC/i);
  assert.doesNotMatch(panel, /tenant|RPC|\bfaz\b/i);
  assert.doesNotMatch(catalogWorker, /owner veya manager/i);
  assert.doesNotMatch(availabilityWorker, /owner veya manager/i);
  assert.match(page, /İŞLETME AYARLARI/);
});

await test('F10-04 block write cap has a stable conflict mapping', () => {
  assert.match(availabilityWorker, /AVAILABILITY_BLOCKS_LIMIT_EXCEEDED/);
  assert.match(availabilityWorker, /status: 409 as const/);
});

await test('F10-04 client uses the shared API helper rather than a second fetch stack', () => {
  assert.doesNotMatch(page, /fetch\(/);
  assert.doesNotMatch(panel, /fetch\(/);
  assert.match(page, /api<ManagedCatalog>\('\/api\/catalog'/);
  assert.match(panel, /api\('\/api\/services'/);
});