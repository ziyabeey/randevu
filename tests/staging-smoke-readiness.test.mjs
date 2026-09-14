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

test('session failure emits only a bounded classification receipt, never raw session identity or bearer values', () => {
  assert.match(smoke, /STAGING_SESSION_DIAGNOSTIC/);
  for (const field of [
    'hasUser',
    'membershipsCount',
    'hasActiveBusiness',
    'passwordRecovery',
    'errorCode',
    'hasAccessCookie',
    'hasRefreshCookie',
  ]) {
    assert.match(smoke, new RegExp(field));
  }
  assert.doesNotMatch(smoke, /STAGING_SESSION_DIAGNOSTIC[^\n]*(email|fullName|access_token|refresh_token|STAGING_OWNER_A_EMAIL)/);
  assert.doesNotMatch(smoke, /JSON\.stringify\(session\.data\)/);
});

test('failed hosted session snapshots only access-claim shape before the session call can clear cookies', () => {
  assert.match(smoke, /function accessClaimsDiagnostic\(accessToken\)/);
  assert.match(smoke, /STAGING_ACCESS_CLAIMS_DIAGNOSTIC/);
  for (const field of [
    'tokenParts',
    'payloadParsed',
    'hasSub',
    'subUuid',
    'hasSessionId',
    'sessionIdUuid',
    'amrPresent',
    'amrArray',
    'amrCount',
    'hasPasswordMethod',
    'hasRecoveryMethod',
    'hasTokenRefreshMethod',
    'aalClass',
    'audAuthenticated',
    'roleAuthenticated',
  ]) {
    assert.match(smoke, new RegExp(field));
  }

  const snapshotIndex = smoke.indexOf("const accessClaims = accessClaimsDiagnostic(cookies.get('yzt_access'));");
  const sessionIndex = smoke.indexOf("const session = await request('/api/session');");
  assert.ok(snapshotIndex >= 0 && sessionIndex > snapshotIndex, 'access claim shape must be captured before /api/session can clear the cookie jar');

  assert.doesNotMatch(smoke, /console\.(?:log|error)\([^\n]*(?:accessToken|cookies\.get\('yzt_access'\)|payload\.sub|payload\.session_id|payload\.email)/);
  assert.doesNotMatch(smoke, /JSON\.stringify\(payload\)/);
  assert.doesNotMatch(smoke, /STAGING_ACCESS_CLAIMS_DIAGNOSTIC[^\n]*(STAGING_OWNER_A_EMAIL|access_token|refresh_token)/);
});
