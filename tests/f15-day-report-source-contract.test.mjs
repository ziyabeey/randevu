import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(file)=>readFileSync(path.join(root,file),'utf8');

test('F15-04 report is a read-only single-snapshot projection over accepted sources',()=>{
  const migration=read('supabase/migrations/20260923170000_f15_day_report.sql');
  assert.match(migration,/create or replace function public\.get_financial_day_report/);
  assert.match(migration,/language plpgsql\s+stable\s+security definer/s);
  assert.match(migration,/'financial_reports_read'::public\.financial_permission_key/);
  assert.match(migration,/p_start_date::timestamp at time zone v_timezone/);
  assert.match(migration,/\(p_end_date \+ 1\)::timestamp at time zone v_timezone/);
  assert.match(migration,/from public\.ticket_payment_events/);
  assert.match(migration,/from public\.expense_events/);
  assert.match(migration,/from public\.appointments/);
  assert.match(migration,/a\.starts_at>=v_from and a\.starts_at<v_to/);
  assert.match(migration,/from ticket_scope ts\s+join public\.ticket_product_returns r/s);
  assert.match(migration,/from ticket_scope ts\s+join public\.ticket_payment_events e/s);
  assert.match(migration,/t\.created_at>=v_from and t\.created_at<v_to/);
  assert.match(migration,/'asOf',statement_timestamp\(\)/);
  assert.doesNotMatch(migration,/create table .*report/i);
  assert.doesNotMatch(migration,/update public\.ticket_payment_events|delete from public\.ticket_payment_events/i);
});

test('F15-04 worker derives business scope and exposes only a GET report route',()=>{
  const worker=read('worker/reports.ts');
  const app=read('worker/app.ts');
  assert.match(worker,/reports\.get\('\/reports\/financial'/);
  assert.match(worker,/p_business_id: access\.membership\.business_id/);
  assert.doesNotMatch(worker,/body\.businessId|query\('businessId'\)/);
  assert.match(worker,/REPORT_CURRENCY_MIXED/);
  assert.match(app,/app\.route\('\/api', reports\)/);
});

test('F15-04 UI keeps cash movement, sales and outstanding as separate concepts',()=>{
  const page=read('src/FinancialReportsPage.tsx');
  const routes=read('src/workspace-route.ts');
  const kolay=read('src/kolayapp/KolayAppSurface.tsx');
  assert.match(page,/Net hareket/);
  assert.match(page,/Tahsilat/);
  assert.match(page,/Masraf/);
  assert.match(page,/Beklenen randevu bedeli/);
  assert.match(page,/Satış değeri/);
  assert.match(page,/Açık bakiye/);
  assert.match(page,/Para girişine eklenmez/);
  assert.match(page,/requestController\.current\?\.abort\(\)/);
  assert.match(page,/const generation = \+\+requestGeneration\.current/);
  assert.match(page,/signal: controller\.signal/);
  assert.match(page,/generation !== requestGeneration\.current/);
  assert.match(page,/requestGeneration\.current \+= 1/);
  assert.match(routes,/'\/app\/reports': 'reports'/);
  assert.match(kolay,/ActionLink href="\/app\/reports" title="Kasa"/);
});
