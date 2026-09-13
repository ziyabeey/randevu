import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-f10-auth-acceptance-current.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('F10 hosted auth acceptance command is wired to the post-S01 script', () => {
  assert.equal(pkg.scripts['staging:f10-auth-acceptance'], 'node scripts/staging-f10-auth-acceptance-current.mjs');
});

test('F10 hosted acceptance proves Origin, CSRF, refresh and current membership state', () => {
  assert.match(script, /ORIGIN_FORBIDDEN/);
  assert.match(script, /CSRF_INVALID/);
  assert.match(script, /f10-expired-access-token/);
  assert.match(script, /Refresh-token session recovery did not rotate the access cookie/);
  assert.match(script, /set active = false/);
  assert.match(script, /Session did not re-check the current DB membership state/);
  assert.match(script, /set active = true/);
  assert.match(script, /membership did not restore before password rotation/);
});

test('F10 hosted acceptance respects S01 recovery authority and still proves password and signup rotation', () => {
  assert.match(script, /generateLink\('recovery'/);
  assert.match(script, /unattested admin recovery shortcut/);
  assert.match(script, /AUTH_LINK_INVALID/);
  assert.match(script, /Rejected admin recovery shortcut installed a browser session/);
  assert.match(script, /generateLink\('signup'/);
  assert.match(script, /auth\/v1\/admin\/\$\{path\}/);
  assert.match(script, /\/api\/auth\/confirm/);
  assert.match(script, /Authenticated password update failed/);
  assert.match(script, /old password login after password rotation/);
  assert.match(script, /Original staging owner password could not be restored/);
  assert.match(script, /temporary staging signup user/);
  assert.doesNotMatch(script, /Hosted recovery token confirmation failed/);
  assert.doesNotMatch(script, /PASSWORD_UPDATE_REQUIRED/);
});

test('F10 hosted acceptance leaves the real public recovery path to S01 and keeps bearer values out of output', () => {
  assert.match(script, /real public recovery \+ PKCE/);
  assert.match(script, /dedicated S01 hosted acceptance/);
  assert.match(script, /Login response exposed session tokens/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(?:access_token|refresh_token|temporaryPassword|signupPassword)/);
  assert.doesNotMatch(script, /gmail\.com|hotmail\.com|outlook\.com|yahoo\.com/i);
});
