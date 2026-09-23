import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('F15-03 activates expense flows without pulling F15-04 cash report forward',()=>{
  const kolay=readFileSync(path.join(root,'src/kolayapp/KolayAppSurface.tsx'),'utf8');
  const routes=readFileSync(path.join(root,'src/workspace-route.ts'),'utf8');
  const shell=readFileSync(path.join(root,'src/WorkspaceShell.tsx'),'utf8');

  assert.match(kolay,/AppLink href="\/app\/expenses"><strong>Yeni masraf<\/strong>/);
  assert.match(kolay,/AppLink href="\/app\/expenses"><strong>Masraflar<\/strong>/);
  assert.match(kolay,/DisabledAction title="Kasa"/);
  assert.match(routes,/'\/app\/expenses': 'expenses'/);
  assert.match(shell,/lazy\(\(\) => import\('\.\/ExpensesPage'\)\)/);
});

test('F15-03 source keeps expense history append-only and permission-bound',()=>{
  const migration=readFileSync(path.join(root,'supabase/migrations/20260923074000_f15_expense_ledger.sql'),'utf8');
  const worker=readFileSync(path.join(root,'worker/expenses.ts'),'utf8');

  assert.match(migration,/EXPENSE_EVENT_IMMUTABLE/);
  assert.match(migration,/'expenses_write'::public\.financial_permission_key/);
  assert.match(migration,/correct_expense_guarded/);
  assert.match(migration,/'reversal'/);
  assert.match(migration,/correction_of_event_id/);
  assert.match(migration,/'correctionOfEventId',e\.correction_of_event_id/);
  assert.match(worker,/p_business_id: access\.membership\.business_id/);
  assert.doesNotMatch(worker,/body\.businessId/);
});

test('F15-03 persists only exact expense write intents after ambiguous network results',()=>{
  const source=readFileSync(path.join(root,'src/ExpensesPage.tsx'),'utf8');
  assert.match(source,/randevu:expenses:pending-write:v1/);
  assert.match(source,/v\.path\.startsWith\('\/api\/expenses'\)/);
  assert.match(source,/writePendingExpense\(identity\)/);
  assert.match(source,/Kayıtlı isteği doğrula/);
  assert.match(source,/pendingWrite\.businessId===activeBusinessId/);
});


test('F15-03 expense UI renders business-local time and retires reversed source actions',()=>{
  const source=readFileSync(path.join(root,'src/ExpensesPage.tsx'),'utf8');
  assert.match(source,/new Intl\.DateTimeFormat\('tr-TR',\{\s*timeZone,/s);
  assert.match(source,/const reversedSourceIds=new Set\(/);
  assert.match(source,/!reversedSourceIds\.has\(e\.eventId\)/);
  assert.match(source,/Düzeltildi \/ iptal edildi/);
});
