import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(repoRoot, 'src');
const routePlan = await import('../src/marketing/routePlan.ts');
const cutoverInventory = await import('../src/marketing/routeCutoverInventory.ts');
const wranglerConfig = readFileSync(resolve(repoRoot, 'wrangler.jsonc'), 'utf8');

const {
  MARKETING_HOME_PATH,
  WORKSPACE_HOME_PATH,
  resolveMarketingRouteSurface,
} = routePlan;

const {
  ROUTE_CUTOVER_STATUS,
  WORKSPACE_ROOT_RETURN_FILES,
} = cutoverInventory;

function listTsxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function repositoryPath(absolutePath) {
  return relative(repoRoot, absolutePath).replaceAll('\\', '/');
}

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

test('MKT-01 pre-cutover inventory exhaustively tracks current workspace href="/" returns', () => {
  assert.equal(ROUTE_CUTOVER_STATUS, 'pre-cutover');

  const actualRootReturnFiles = listTsxFiles(srcRoot)
    .filter((absolutePath) => readFileSync(absolutePath, 'utf8').includes('href="/"'))
    .map(repositoryPath)
    .sort();
  const expectedRootReturnFiles = [...WORKSPACE_ROOT_RETURN_FILES].sort();

  assert.deepEqual(
    actualRootReturnFiles,
    expectedRootReturnFiles,
    'Workspace root-return inventory drifted. Update the explicit cutover inventory before touching shared routes.',
  );

  assert.equal(expectedRootReturnFiles.length, 10, 'Current main cutover inventory should contain exactly ten known root-return surfaces');
});

test('MKT-01 /app deep links remain compatible with the deployment SPA fallback', () => {
  assert.match(wranglerConfig, /"not_found_handling"\s*:\s*"single-page-application"/);
  assert.match(wranglerConfig, /"run_worker_first"\s*:\s*\["\/api",\s*"\/api\/\*"\]/);
});
