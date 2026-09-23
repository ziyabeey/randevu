import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = resolve(repoRoot, 'src');
const marketingRoot = resolve(srcRoot, 'marketing');
const routePlan = await import('../src/marketing/routePlan.ts');

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

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(absolute);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

function importSpecifiers(source) {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
}

function isInside(directory, absolutePath) {
  const path = relative(directory, absolutePath);
  return path !== '' && !path.startsWith('..');
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

// The marketing site ships on its own origin, so the lane must neither reach into
// private-app modules nor be reachable from them. Checking the import boundary
// keeps that guarantee without pinning main's ever-changing private-app files.
test('MKT-DOMAIN-01 keeps the marketing lane isolated from the private app', () => {
  const marketingFiles = listSourceFiles(marketingRoot);
  assert.ok(marketingFiles.length > 0);

  for (const file of marketingFiles) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        assert.ok(
          isInside(marketingRoot, resolve(dirname(file), specifier)),
          `${repositoryPath(file)} imports ${specifier} outside src/marketing`,
        );
      } else {
        assert.match(
          specifier,
          /^react(?:-dom(?:\/client)?)?$/,
          `${repositoryPath(file)} imports unexpected package ${specifier}`,
        );
      }
    }
  }

  for (const file of listSourceFiles(srcRoot).filter((path) => !isInside(marketingRoot, path))) {
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      assert.ok(
        !isInside(marketingRoot, resolve(dirname(file), specifier)),
        `${repositoryPath(file)} imports marketing module ${specifier}`,
      );
    }
  }
});

test('MKT-DOMAIN-01 sends marketing login links only to the canonical private app', () => {
  const home = readFileSync(resolve(marketingRoot, 'MarketingHome.tsx'), 'utf8');
  assert.match(home, /href=\{WORKSPACE_HOME_PATH\}[^>]*>\s*Giriş yap/);

  for (const file of listSourceFiles(marketingRoot).filter((path) => path.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /href=["'](?:\/|\/app(?:\/[^"']*)?)["']/,
      `${repositoryPath(file)} hardcodes a same-origin app link`,
    );
  }
});
