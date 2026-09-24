import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const page=readFileSync(path.join(root,'src/BookingPage.tsx'),'utf8');
const worker=readFileSync(path.join(root,'worker/f16-series-http.ts'),'utf8');
const migration=readFileSync(path.join(root,'supabase/migrations/20260924023800_f16_recurring_series.sql'),'utf8');

test('F16-01 operator composer exposes bounded daily/weekly recurring creation',()=>{
  assert.match(page,/value="daily">Her gün/);
  assert.match(page,/value="weekly">Her hafta/);
  assert.match(page,/min=\{2\} max=\{12\}/);
  assert.match(page,/\/api\/bookings\/series\/preview/);
  assert.match(page,/seriesPreview\.allAvailable/);
  assert.match(page,/\/api\/bookings\/series'/);
  assert.match(page,/Seriyi oluştur/);
  assert.doesNotMatch(page,/Tekrar<\/strong><small>F16-01 ile açılacak/);
});

test('F16-01 future-scope UI always previews exact targets before mutation',()=>{
  assert.match(page,/Kapsamı önizle/);
  assert.match(page,/seriesFuturePreview\.targets/);
  assert.match(page,/seriesFuturePreview\.skipped/);
  assert.match(page,/seriesFuturePreview\.conflicts/);
  assert.match(page,/target\.groupId/);
  assert.match(page,/\/future\/preview/);
  assert.match(page,/\/future\/reschedule/);
  assert.match(page,/\/future\/cancel/);
  assert.match(page,/!seriesFuturePreview\.allAvailable \|\| !seriesFuturePreview\.targets\.length/);
});

test('F16-01 future mutations remain tenant-derived and series-CAS guarded',()=>{
  assert.match(worker,/p_business_id: access\.membership\.business_id/);
  assert.doesNotMatch(worker,/body\.businessId/);
  assert.match(worker,/p_expected_version: expectedVersion/);
  assert.match(worker,/p_from_ordinal: fromOrdinal/);
  assert.match(migration,/APPOINTMENT_SERIES_VERSION_CONFLICT/);
  assert.match(migration,/preview_appointment_series_future/);
  assert.match(migration,/f16_plan_existing_group_at_many/);
  assert.match(migration,/future_rescheduled/);
  assert.match(migration,/future_cancelled/);
});

test('F16-01 series reads are fenced across workspace and composer changes',()=>{
  assert.match(page,/const loadGeneration = useRef\(0\)/);
  assert.match(page,/const workspaceGeneration = useRef\(0\)/);
  assert.match(page,/const seriesReadGeneration = useRef\(0\)/);
  assert.match(page,/const seriesReadController = useRef<AbortController \| null>\(null\)/);
  assert.match(page,/workspaceGeneration\.current \+= 1/);
  assert.match(page,/seriesReadGeneration\.current \+= 1/);
  assert.match(page,/seriesReadController\.current\?\.abort\(\)/);
  assert.match(page,/result\.series\.businessId !== activeBusinessId/);
  assert.match(page,/refreshed\.series\.businessId !== activeBusinessId/);
  assert.match(page,/result\.preview\.seriesId !== requestedSeriesId/);
  assert.match(page,/scopeGeneration !== workspaceGeneration\.current/);
  assert.match(page,/invalidateSeriesRead\(\)/);
  assert.ok((page.match(/seriesReadIsCurrent\(generation, controller\)/g) ?? []).length >= 4);
  assert.ok((page.match(/signal: controller\.signal/g) ?? []).length >= 6);
});
