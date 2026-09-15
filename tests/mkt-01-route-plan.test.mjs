import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(repoRoot, 'src');
const routePlan = await import('../src/marketing/routePlan.ts');
const cutoverInventory = await import('../src/marketing/routeCutoverInventory.ts');

const {
  MARKETING_HOME_PATH,
  MARKETING_ORIGIN,
  PRIVATE_APP_HOME_PATH,
  PRIVATE_OPERATOR_APP_ORIGIN,
  PUBLIC_TENANT_ORIGIN_PATTERN,
  WORKSPACE_HOME_PATH,
  getOperatorAppHref,
  getPublicTenantOrigin,
  resolveMarketingRouteSurface,
} = routePlan;

const {
  PRIVATE_APP_ROOT_RETURN_FILES,
  ROUTE_CUTOVER_STATUS,
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

test('MKT-DOMAIN-01 fixes one public marketing origin and one private operator origin', () => {
  assert.equal(MARKETING_ORIGIN, 'https://randevukolay.net');
  assert.equal(PRIVATE_OPERATOR_APP_ORIGIN, 'https://randevu.kepenk.ai');
  assert.equal(PUBLIC_TENANT_ORIGIN_PATTERN, 'https://{business-slug}.randevukolay.net');
  assert.equal(MARKETING_HOME_PATH, '/');
  assert.equal(PRIVATE_APP_HOME_PATH, '/');

  // Node has no browser location, so the production-safe value must be canonical.
  assert.equal(WORKSPACE_HOME_PATH, 'https://randevu.kepenk.ai/');
  assert.equal(
    getOperatorAppHref({ hostname: 'randevukolay.net', pathname: '/' }),
    'https://randevu.kepenk.ai/',
  );
  assert.equal(
    getOperatorAppHref({ hostname: 'localhost', pathname: '/' }),
    '/app',
  );
  assert.equal(
    getOperatorAppHref({ hostname: 'preview.invalid', pathname: '/marketing-preview.html' }),
    '/app',
  );

  assert.equal(getPublicTenantOrigin('demo-salon'), 'https://demo-salon.randevukolay.net');
  assert.throws(() => getPublicTenantOrigin('bad.slug'), /valid lowercase DNS label/);
  assert.notEqual(PRIVATE_OPERATOR_APP_ORIGIN, 'https://app.randevukolay.net');
});

test('MKT-DOMAIN-01 route contract does not treat marketing /app as the private workspace', () => {
  assert.equal(
    resolveMarketingRouteSurface({ origin: MARKETING_ORIGIN, path: '/' }),
    'marketing',
  );
  assert.equal(
    resolveMarketingRouteSurface({ origin: MARKETING_ORIGIN, path: '/app' }),
    'other',
  );
  assert.equal(
    resolveMarketingRouteSurface({ origin: PRIVATE_OPERATOR_APP_ORIGIN, path: '/' }),
    'private-app',
  );
  assert.equal(
    resolveMarketingRouteSurface({ origin: PRIVATE_OPERATOR_APP_ORIGIN, path: '/calendar' }),
    'private-app',
  );
  assert.equal(
    resolveMarketingRouteSurface({ origin: 'https://demo-salon.randevukolay.net', path: '/' }),
    'other',
  );
});

test('MKT-DOMAIN-01 preserves existing private-app root returns instead of rewriting them to /app', () => {
  assert.equal(ROUTE_CUTOVER_STATUS, 'domain-separated-pre-cutover');

  const actualRootReturnFiles = listTsxFiles(srcRoot)
    .filter((absolutePath) => readFileSync(absolutePath, 'utf8').includes('href="/"'))
    .map(repositoryPath)
    .sort();
  const expectedRootReturnFiles = [...PRIVATE_APP_ROOT_RETURN_FILES].sort();

  assert.deepEqual(
    actualRootReturnFiles,
    expectedRootReturnFiles,
    'Private-app root-return inventory drifted. Domain separation must not silently rewrite shared routes.',
  );

  assert.equal(expectedRootReturnFiles.length, 10, 'Current main inventory should contain exactly ten known private-app root-return surfaces');
});
