import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smoke = readFileSync(new URL('../scripts/staging-smoke.mjs', import.meta.url), 'utf8');

test('staging smoke waits briefly for a freshly deployed Worker before login', () => {
  assert.match(smoke, /const HEALTH_ATTEMPTS = 8;/);
  assert.match(smoke, /const HEALTH_RETRY_DELAY_MS = 1500;/);
  assert.match(smoke, /async function waitForHealth\(\)/);
  assert.match(smoke, /attempt <= HEALTH_ATTEMPTS/);
  assert.match(smoke, /await sleep\(HEALTH_RETRY_DELAY_MS\)/);
  assert.match(smoke, /await waitForHealth\(\);/);

  const healthIndex = smoke.indexOf('await waitForHealth();');
  const loginIndex = smoke.indexOf("const login = await request('/api/auth/login'");
  assert.ok(healthIndex >= 0 && loginIndex > healthIndex, 'readiness must complete before the one-shot auth smoke begins');
});

test('readiness retry is bounded and does not retry login/session/catalog assertions', () => {
  assert.match(smoke, /Staging health check failed after \$\{HEALTH_ATTEMPTS\} attempts/);
  assert.doesNotMatch(smoke, /waitForHealth[\s\S]*api\/auth\/login[\s\S]*HEALTH_ATTEMPTS/);
  assert.match(smoke, /Staging app login failed with HTTP/);
  assert.match(smoke, /Staging session lookup failed with HTTP/);
  assert.match(smoke, /Staging catalog failed with HTTP/);
});
