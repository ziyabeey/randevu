import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-f10-auth-acceptance.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('F10 hosted auth acceptance command is wired to its dedicated script', () => {
  assert.equal(pkg.scripts['staging:f10-auth-acceptance'], 'node scripts/staging-f10-auth-acceptance.mjs');
});

test('F10 hosted acceptance proves Origin, CSRF, refresh and current membership state', () => {
  assert.match(script, /ORIGIN_FORBIDDEN/);
  assert.match(script, /CSRF_INVALID/);
  assert.match(script, /f10-expired-access-token/);
  assert.match(script, /Refresh-token session recovery did not rotate the access cookie/);
  assert.match(script, /set active = false/);
  assert.match(script, /Session did not re-check the current DB membership state/);
  assert.match(script, /set active = true/);
});

test('F10 hosted acceptance proves signup confirmation, recovery and password rotation', () => {
  assert.match(script, /generateLink\('recovery'/);
  assert.match(script, /generateLink\('signup'/);
  assert.match(script, /auth\/v1\/admin\/\$\{path\}/);
  assert.match(script, /\/api\/auth\/confirm/);
  assert.match(script, /PASSWORD_UPDATE_REQUIRED/);
  assert.match(script, /AUTH_LINK_INVALID/);
  assert.match(script, /old password login after recovery/);
  assert.match(script, /Original staging owner password could not be restored/);
  assert.match(script, /temporary staging signup user/);
});

test('F10 hosted acceptance keeps bearer values out of user-visible output', () => {
  assert.match(script, /Login response exposed session tokens/);
  assert.match(script, /Recovery confirmation exposed session tokens/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(?:access_token|refresh_token|temporaryPassword|signupPassword)/);
  assert.doesNotMatch(script, /gmail\.com|hotmail\.com|outlook\.com|yahoo\.com/i);
});
