import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routePlan = await import('../src/marketing/routePlan.ts');
const wranglerConfig = readFileSync(resolve(repoRoot, 'wrangler.jsonc'), 'utf8');

const {
  MARKETING_HOME_PATH,
  WORKSPACE_HOME_PATH,
  resolveMarketingRouteSurface,
} = routePlan;

test('MKT-01 production route plan preserves the pending invite flow at root', () => {
  assert.equal(MARKETING_HOME_PATH, '/');
  assert.equal(WORKSPACE_HOME_PATH, '/app');

  assert.equal(
    resolveMarketingRouteSurface({ path: '/', hasPendingTeamInvite: true }),
    'invite',
  );

  assert.equal(
    resolveMarketingRouteSurface({ path: '/', hasPendingTeamInvite: false }),
    'marketing',
  );
});

test('MKT-01 production route plan moves the existing workspace root to /app without stealing product routes', () => {
  assert.equal(
    resolveMarketingRouteSurface({ path: '/app', hasPendingTeamInvite: false }),
    'workspace',
  );
  assert.equal(
    resolveMarketingRouteSurface({ path: '/app/', hasPendingTeamInvite: false }),
    'workspace',
  );

  for (const path of ['/calendar', '/bookings', '/customers', '/availability', '/team', '/public-booking', '/r/demo']) {
    assert.equal(
      resolveMarketingRouteSurface({ path, hasPendingTeamInvite: false }),
      'other',
      `Marketing route plan must not claim ${path}`,
    );
  }
});

test('MKT-01 /app deep links remain compatible with the deployment SPA fallback', () => {
  assert.match(wranglerConfig, /"not_found_handling"\s*:\s*"single-page-application"/);
  assert.match(wranglerConfig, /"run_worker_first"\s*:\s*\["\/api",\s*"\/api\/\*"\]/);
});
