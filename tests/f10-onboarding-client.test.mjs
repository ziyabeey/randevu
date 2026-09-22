import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/OnboardingPage.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/WorkspaceShell.tsx', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/workspace-route.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260914090000_f10_onboarding_readiness.sql', import.meta.url), 'utf8');

await test('F10-03 setup is a dedicated canonical workspace surface without replacing invite/team routes', () => {
  assert.match(routes, /'\/app\/setup': 'setup'/);
  assert.match(routes, /'\/app\/team': 'team'/);
  assert.match(routes, /pathname === '\/' && pendingInvite/);
  assert.match(shell, /page === 'setup'\) return <OnboardingPage/);
  assert.match(shell, /page === 'team'\) return <TeamPage/);
});

await test('F10-03 business switch aborts stale reads, clears old setup state and delegates authority to the shared shell', () => {
  assert.match(page, /requestController\.current\?\.abort\(\)/);
  assert.match(page, /const generation = \+\+requestGeneration\.current/);
  assert.match(page, /if \(generation !== requestGeneration\.current\) return/);
  assert.match(page, /setSnapshot\(null\);\s*setSlots\(\[\]\);/s);
  assert.match(page, /await selectBusiness\(businessId\)/);
  assert.match(page, /if \(businessId === activeBusinessId\) return/);
  assert.doesNotMatch(page, /window\.location\.(?:assign|replace)|\/api\/businesses\/select/);
});

await test('F10-03 reuses shared AbortSignal-capable API instead of creating a second HTTP client', () => {
  assert.match(api, /const callerSignal = init\.signal/);
  assert.match(api, /callerSignal\?\.addEventListener\('abort'/);
  assert.doesNotMatch(page, /\/api\/session/);
  assert.match(page, /useWorkspace/);
  assert.match(page, /api<Snapshot>\('\/api\/onboarding', \{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(page, /fetch\(/);
});

await test('F10-03 owner-as-staff consumes F10-02 staff membership linking instead of inventing a second account model', () => {
  assert.match(page, /\/api\/team\/staff\/\$\{result\.staff\.id\}\/membership/);
  assert.match(page, /membershipId: snapshot\.membership\.id/);
  assert.match(page, /ownerAsStaff/);
  assert.doesNotMatch(page, /createOwnerStaff|owner_staff_memberships|staff_accounts/);
});

await test('F10-03 onboarding resume is derived from persisted domain state with no wizard progress table', () => {
  assert.match(migration, /business_onboarding_readiness_internal/);
  assert.match(migration, /from public\.services/);
  assert.match(migration, /from public\.staff_profiles/);
  assert.match(migration, /from public\.staff_services/);
  assert.match(migration, /from public\.business_hours/);
  assert.match(migration, /from public\.staff_hours/);
  assert.doesNotMatch(migration, /create table[^;]*onboarding/i);
  assert.doesNotMatch(page, /localStorage|onboarding_progress/);
});

await test('F10-03 publish UI is advisory while DB readiness remains authoritative', () => {
  assert.match(page, /disabled=\{busy \|\| !snapshot\.readiness\.publishable\}/);
  assert.match(page, /await api\('\/api\/public\/settings'/);
  assert.match(migration, /if p_enabled then/);
  assert.match(migration, /PUBLIC_BOOKING_NOT_READY/);
});
