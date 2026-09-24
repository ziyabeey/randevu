import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  contradiction,
  isR0Candidate,
  productionClean,
  renderSummary,
  reviewText,
  run,
} from '../scripts/jev-r0-shadow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DE-JEV-R0 copies the production R0 clean rule verbatim', () => {
  const production = readFileSync(path.join(root, 'scripts/prepare-development-review-observation.mjs'), 'utf8');
  const shadow = readFileSync(path.join(root, 'scripts/jev-r0-shadow.mjs'), 'utf8');
  for (const line of [
    'const structuredCleanVerdict = /verdict\\s*:\\s*(?:no\\s+findings|acceptable)/i.test(body);',
    'const nativeNoFindings = /\\*\\*findings:\\**\\s*none/i.test(body);',
    'const claimsUnresolved = /unresolved[^\\n]*(?:issue|finding|remain)|(?:issue|finding)[^\\n]*remain[^\\n]*unresolved/i.test(body);',
    'structuredCleanVerdict || (nativeNoFindings && !claimsUnresolved);',
    "/copilot-pull-request-reviewer/i.test(author)",
    "/(?:^|[^a-z0-9])r0(?:[^a-z0-9]|$)/i.test(body)",
  ]) {
    assert.ok(production.includes(line), `production rule changed: ${line}`);
    assert.ok(shadow.includes(line), `shadow copy drifted: ${line}`);
  }
});

test('production rule behaviour is reproduced on real receipt shapes', () => {
  assert.equal(productionClean('VERDICT: ACCEPTABLE\nBLOCKERS: NONE'), true);
  assert.equal(productionClean('VERDICT: **ACCEPTABLE**'), false);
  assert.equal(productionClean('### 🔵 Needs a closer look\n\nIssue.\n\n**Findings:** None'), true);
  assert.equal(productionClean('### 🟡 Changes recommended\n\nTwo moderate issues remain unresolved.'), false);
  assert.equal(isR0Candidate({ author: 'copilot-pull-request-reviewer[bot]', body: 'x' }), true);
  assert.equal(isR0Candidate({ author: 'someone', association: 'COLLABORATOR', body: 'Role: R0\nVERDICT: ACCEPTABLE' }), true);
  assert.equal(isR0Candidate({ author: 'someone', association: 'NONE', body: 'Role: R0\nVERDICT: ACCEPTABLE' }), false);
});

test('only confident disagreements are flagged', () => {
  assert.equal(contradiction(true, { choice: 'clean', confidence: 0.99 }), null);
  assert.equal(contradiction(false, { choice: 'clean', confidence: 0.95 }), 'regex_blocked_jev_clean');
  assert.equal(contradiction(true, { choice: 'changes_needed', confidence: 0.92 }), 'regex_clean_jev_not_clean');
  assert.equal(contradiction(true, { choice: 'needs_human', confidence: 0.5 }), null);
  assert.equal(contradiction(false, null), null);
});

test('review text strips markup and is bounded', () => {
  const text = reviewText('<!-- ccr -->\n## A\n<picture><source srcset="x"></picture>ok <b>b</b>' + 'x'.repeat(20_000));
  assert.ok(!text.includes('<'));
  assert.ok(text.length <= 12_000);
});

function fakeFetch(calls, { jev = { choice: 'clean', confidence: 0.97 } } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.typesafe.ai/')) {
      return json({ model: 'jev-1.13.0', answers: { verdict: { type: 'choice', ...jev, probabilities: {} } }, usage: { input_tokens: 10 } });
    }
    if (url.includes('/pulls?')) return json([{ number: 7, updated_at: '2026-09-24T00:00:00Z' }]);
    if (url.includes('/pulls/7/reviews')) {
      return json([{ id: 1, user: { login: 'copilot-pull-request-reviewer[bot]' }, author_association: 'NONE', submitted_at: '2026-09-23T00:00:00Z', html_url: 'https://github.com/o/r/pull/7#pullrequestreview-1', body: '### 🟢 Approval recommended\n\nOnly a nit.\n\n**Findings:** 1' }]);
    }
    if (url.includes('/issues/7/comments')) return json([]);
    throw new Error(`unexpected ${url}`);
  };
}

const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', LOOKBACK_DAYS: '7' };
const now = new Date('2026-09-24T12:00:00Z');

test('without TYPESAFE_API_KEY the control skips without any request', async () => {
  const calls = [];
  const result = await run({ env, fetchImpl: fakeFetch(calls), now });
  assert.equal(calls.length, 0);
  assert.match(renderSummary(result), /Skipped: TYPESAFE_API_KEY is not configured/);
});

test('the control only reads GitHub and reports a confident contradiction', async () => {
  const calls = [];
  const result = await run({ env: { ...env, TYPESAFE_API_KEY: 'k' }, fetchImpl: fakeFetch(calls), now });
  assert.ok(calls.filter((call) => call.url.startsWith('https://api.github.com/')).every((call) => call.method === 'GET'));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].regexClean, false);
  assert.equal(result.rows[0].flag, 'regex_blocked_jev_clean');
  assert.match(renderSummary(result), /flags \(≥ 0\.9\): \*\*1\*\*/);
});

test('a Jev failure is recorded and does not throw', async () => {
  const calls = [];
  const failing = async (url, init) => (url.startsWith('https://api.typesafe.ai/')
    ? new Response('{}', { status: 503 })
    : fakeFetch(calls)(url, init));
  const result = await run({ env: { ...env, TYPESAFE_API_KEY: 'k' }, fetchImpl: failing, now });
  assert.equal(result.rows[0].error, 'TypeSafe 503');
  assert.equal(result.rows[0].flag, undefined);
});

test('the DE-JEV-R0 workflow stays advisory: scheduled/manual, read-only, no PR trigger', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/development-jev-r0-shadow.yml'), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
  assert.match(triggers, /schedule:/);
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /pull_request|issue_comment|push:/);
  assert.doesNotMatch(workflow, /:\s*write\b/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /TYPESAFE_API_KEY: \$\{\{ secrets\.TYPESAFE_API_KEY \}\}/);
  assert.match(workflow, /run: node scripts\/jev-r0-shadow\.mjs/);
});
