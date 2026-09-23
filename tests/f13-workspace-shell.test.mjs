import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAppRoute } from '../src/workspace-route.ts';

test('F13-04 route authority separates capability, public, invite, canonical workspace and legacy routes', () => {
  assert.deepEqual(resolveAppRoute('/m', true), { kind: 'management' });
  assert.deepEqual(resolveAppRoute('/r/test-salon', true), { kind: 'public', slug: 'test-salon' });
  assert.deepEqual(resolveAppRoute('/', true), { kind: 'invite' });
  assert.deepEqual(resolveAppRoute('/', false), { kind: 'redirect', to: '/app' });
  assert.deepEqual(resolveAppRoute('/calendar', false), { kind: 'redirect', to: '/app/calendar' });
  assert.deepEqual(resolveAppRoute('/app', false), { kind: 'workspace', page: 'calendar' });
  assert.deepEqual(resolveAppRoute('/app/services', false), { kind: 'workspace', page: 'services' });
  assert.deepEqual(resolveAppRoute('/app/does-not-exist', false), { kind: 'workspace', page: 'not-found' });
  assert.deepEqual(resolveAppRoute('/does-not-exist', false), { kind: 'not-found' });
});

test('F13-04 shell consumes existing workspace authority instead of creating a second client', () => {
  const shell = readFileSync(new URL('../src/WorkspaceShell.tsx', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../worker/auth-routes.ts', import.meta.url), 'utf8');
  assert.match(shell, /api<WorkspaceSession>\('\/api\/session'\)/);
  assert.match(shell, /api\('\/api\/businesses\/select'/);
  assert.match(shell, /scopeEpoch/);
  assert.match(main, /installWorkspaceCoherence\(\{ readsSessionItself: true \}\)/);
  assert.match(main, /setWorkspaceGuard\(workspaceGuard\)/);
  assert.doesNotMatch(shell, /fetch\(/);
  assert.match(auth, /new URL\('\/app', applicationOrigin\(context\)\)/);
});

test('F13-04 panel navigation keeps calendar primary and does not masquerade as SalonApp', () => {
  const shell = readFileSync(new URL('../src/WorkspaceShell.tsx', import.meta.url), 'utf8');
  assert.ok(shell.indexOf("page: 'calendar'") < shell.indexOf("page: 'bookings'"));
  assert.match(shell, /page: 'customers'/);
  assert.match(shell, /page: 'services'/);
  assert.match(shell, /page: 'team'/);
  assert.match(shell, /page: 'setup'/);
  assert.doesNotMatch(shell, /Adisyonlar|Yeni paket|Yeni masraf/);
  assert.match(shell, /page: 'expenses', label: 'Masraflar'/);
});

test('F13-04 private domain pages do not create parallel session authorities', () => {
  for (const path of ['CustomersPage.tsx', 'BookingPage.tsx', 'AvailabilityPage.tsx', 'OnboardingPage.tsx']) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\/api\/session/);
    assert.match(source, /useWorkspace/);
  }
  const calendar = readFileSync(new URL('../src/CalendarPage.tsx', import.meta.url), 'utf8');
  assert.match(calendar, /navigateApp\("\/app\/bookings"\)/);
  assert.doesNotMatch(calendar, /href="\/bookings"/);
});

test('F13-04 real-browser acceptance is wired into the required browser suite', () => {
  const smoke = readFileSync(new URL('../scripts/browser-smoke.sh', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/browser-f13-workspace-shell.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /browser-f13-workspace-shell\.mjs/);
  assert.match(runner, /root compatibility did not land on mobile calendar workspace/);
  assert.match(runner, /customer management did not reflect operator calendar change/);
  assert.match(runner, /expectedBusiness/);
});
