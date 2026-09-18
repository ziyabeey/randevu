import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  authoritySignal,
  errorText,
  isPrivilegedAuthorityDenial,
  isTransientAuthorityRead,
  retainsVerifiedAuthorityView,
} from '../src/sessionCoherence.ts';

const teamPage = readFileSync(new URL('../src/TeamPage.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

function apiError(status, message = 'Servis hatası') {
  return Object.assign(new Error(message), { name: 'ApiRequestError', status });
}

test('F10-06R separates privileged denial from retryable provider failures', () => {
  assert.equal(authoritySignal(apiError(403, 'Yetkiniz yok')), 'privilege-denial');
  assert.equal(authoritySignal(apiError(401, 'Oturum gerekli')), 'privilege-denial');
  assert.equal(authoritySignal(apiError(503)), 'transient');
  assert.equal(authoritySignal(apiError(500)), 'transient');
  assert.equal(authoritySignal(apiError(429)), 'transient');
  assert.equal(authoritySignal(apiError(408)), 'transient');
  assert.equal(authoritySignal(apiError(0, 'İstek zamanında tamamlanamadı.')), 'transient');
  assert.equal(authoritySignal(new TypeError('Failed to fetch')), 'transient');
  assert.equal(authoritySignal(apiError(400, 'Geçersiz istek')), 'rejected');
});

test('F10-06R only a verified denial may invalidate the last verified authority view', () => {
  assert.equal(isPrivilegedAuthorityDenial(apiError(403)), true);
  assert.equal(retainsVerifiedAuthorityView(apiError(403)), false);
  assert.equal(isTransientAuthorityRead(apiError(503)), true);
  assert.equal(isPrivilegedAuthorityDenial(apiError(503)), false);
  assert.equal(retainsVerifiedAuthorityView(apiError(503)), true);
  assert.equal(retainsVerifiedAuthorityView(apiError(400)), true);
});

test('F10-06R keeps server wording and falls back to the retryable wording', () => {
  assert.equal(errorText(apiError(503, 'Hizmet geçici olarak kapalı'), 'fallback'), 'Hizmet geçici olarak kapalı');
  assert.equal(errorText(new Error('   '), 'fallback'), 'fallback');
  assert.equal(errorText('unexpected', 'fallback'), 'fallback');
});

test('F10-06R team view preserves the verified snapshot on a transient read and fails closed on denial', () => {
  assert.match(teamPage, /from '\.\/sessionCoherence'/);
  // Regression: TRANSIENT_TEAM_READ_ERASES_AUTHORITY_VIEW nulled the snapshot in every catch arm.
  assert.doesNotMatch(teamPage, /catch \(error\) \{\s*setTeam\(null\);/);
  assert.match(teamPage, /const retainsVerifiedView = retainsVerifiedAuthorityView\(error\);/);
  assert.match(teamPage, /if \(!retainsVerifiedView\) setTeam\(null\);/);
  assert.match(teamPage, /setStale\(retainsVerifiedView\);/);
  // Stale/retryable status is surfaced as retryable, never as access loss.
  assert.match(teamPage, /\{stale && \(/);
  assert.match(teamPage, /son doğrulanmış kayıt gösteriliyor\./);
});

test('F10-06R privileged denial refreshes authority so stale manager controls cannot stay actionable', () => {
  // Regression: STALE_ROLE_UI_AFTER_403 kept rendering manager controls after the 403.
  assert.match(teamPage, /async function invalidateAfterDenial\(error: unknown\)/);
  assert.match(teamPage, /if \(!isPrivilegedAuthorityDenial\(error\)\) return false;/);
  assert.match(teamPage, /await load\(\{ silent: true \}\);/);
  const refreshed = teamPage.match(/await invalidateAfterDenial\(error\)/g) ?? [];
  assert.ok(refreshed.length >= 2, 'every privileged mutation path must re-verify authority after a denial');
});

test('F10-06R transient session failure is not presented as a logout', () => {
  assert.match(app, /from '\.\/sessionCoherence'/);
  assert.match(app, /const \[unverifiableSession, setUnverifiableSession\] = useState\(false\);/);
  // Regression: TRANSIENT_SESSION_503_LOOKS_LOGGED_OUT only reported the failure text.
  assert.doesNotMatch(app, /setNotice\(error instanceof Error \? error\.message : 'Bağlantı kurulamadı\.'\)/);
  assert.match(app, /setUnverifiableSession\(true\);/);
  // The login form may render only for a verified anonymous session.
  assert.match(app, /\{!session\?\.user \?\s*\(\s*unverifiableSession \?\s*\(\s*<section className="panel auth-panel">/);
  assert.match(app, /\.onClick\(\) => setUnverifiableSession\(false\)/);
});

