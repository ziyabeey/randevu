import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authenticatedReceipts, classifyFileRecords, freshnessReport, parseReviewerAllowlist, sameIdentity, verifiedReceipts } from '../scripts/development-audit-gate.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const caseFp = 'c'.repeat(64), requestFp = 'd'.repeat(64), challenge = 'e'.repeat(64);
const challengeHash = createHash('sha256').update(challenge).digest('hex');
const pr = { number: 201, state: 'open', head: { sha: head }, base: { sha: base }, user: { login: 'author' } };
const allowlist = { R1: ['claude[bot]'], R2: ['claude[bot]'] };

function receipt(change = {}, itemChange = {}) {
  const marker = {
    schemaVersion: 'development-review-receipt.v1',
    role: 'R1',
    prNumber: 201,
    headSha: head,
    baseSha: base,
    dispatcherCaseFingerprint: caseFp,
    requestFingerprint: requestFp,
    receiptChallenge: challenge,
    verdict: 'ACCEPTABLE',
    ...change,
  };
  return {
    id: 42,
    user: { login: 'claude[bot]' },
    html_url: 'https://github.com/example/repo/pull/201#issuecomment-42',
    body: `<!-- development-review-receipt ${JSON.stringify(marker)} -->`,
    ...itemChange,
  };
}

function launch(change = {}, itemChange = {}) {
  const role = change.role ?? 'R1';
  const requestFingerprint = change.requestFingerprint ?? requestFp;
  const dispatcherCaseFingerprint = change.dispatcherCaseFingerprint ?? caseFp;
  const headSha = change.headSha ?? head;
  const baseSha = change.baseSha ?? base;
  return {
    id: 7,
    user: { login: 'github-actions[bot]' },
    html_url: 'https://github.com/example/repo/pull/201#issuecomment-7',
    body: [
      `<!-- development-review-launch:${role.toLowerCase()}:${requestFingerprint} -->`,
      '## Development Routine launch',
      '- status: ROUTINE_TRIGGERED',
      `- exact head: ${headSha}`,
      `- base main: ${baseSha}`,
      `- dispatcher case: ${dispatcherCaseFingerprint}`,
      `- role request: ${requestFingerprint}`,
      `- receipt challenge hash: ${change.receiptChallengeHash ?? challengeHash}`,
    ].join('\n'),
    ...itemChange,
  };
}

function evidence(change = {}, itemChange = {}) {
  return [launch(change), receipt(change, itemChange)];
}

test('docs classifier includes rename origin and refuses incomplete evidence', () => {
  assert.equal(classifyFileRecords([{ filename: 'TASKS.md' }], 1), 'docs');
  assert.equal(classifyFileRecords([{ filename: 'TASKS.md' }], 2), 'unknown');
  assert.equal(classifyFileRecords([{ filename: 'docs/a.md', status: 'renamed', previous_filename: 'src/a.ts' }], 1), 'code');
  assert.equal(classifyFileRecords([{ filename: 'docs/a.md', status: 'renamed' }], 1), 'unknown');
  assert.equal(classifyFileRecords([], 0), 'code');
});

test('malformed reviewer allowlist fails closed to no trusted roles', () => {
  assert.deepEqual(parseReviewerAllowlist('{not-json'), {});
  assert.deepEqual(parseReviewerAllowlist('[]'), {});
  assert.deepEqual(parseReviewerAllowlist(''), {});
  assert.deepEqual(parseReviewerAllowlist(JSON.stringify(allowlist)), allowlist);
});

test('exactly one dedicated publisher per role is required; one challenge-bound Claude bot may serve both roles', () => {
  assert.equal(verifiedReceipts(evidence(), pr, allowlist).length, 1);
  for (const login of ['copilot-pull-request-reviewer[bot]', 'chatgpt-codex-connector[bot]', 'github-actions[bot]', 'author', 'stranger']) {
    assert.deepEqual(verifiedReceipts([launch(), { ...receipt(), user: { login } }], pr, allowlist), []);
  }
  assert.deepEqual(verifiedReceipts([launch(), { ...receipt(), body: 'R1 ACCEPTABLE current head approved' }], pr, allowlist), []);
  assert.deepEqual(verifiedReceipts(evidence(), pr), []);
  assert.deepEqual(verifiedReceipts(evidence(), pr, { R1: ['a[bot]', 'b[bot]'], R2: ['claude[bot]'] }), []);
  assert.deepEqual(verifiedReceipts(evidence(), pr, { R1: ['claude[bot]'], R2: 'claude[bot]' }), []);
});

test('receipt identity, launch binding and head/base freshness are deterministic', () => {
  const current = verifiedReceipts(evidence(), pr, allowlist)[0];
  assert.equal(current.freshness, 'current');
  assert.equal(current.requestFingerprint, requestFp);
  assert.equal(current.dispatcherCaseFingerprint, caseFp);
  assert.equal(current.verdict, 'ACCEPTABLE');

  for (const [index, delta] of [{ headSha: 'e'.repeat(40) }, { baseSha: 'f'.repeat(40) }].entries()) {
    const changed = { ...delta, requestFingerprint: String(index + 1).repeat(64) };
    assert.equal(verifiedReceipts([launch(changed), receipt(changed)], pr, allowlist)[0].freshness, 'stale');
  }

  for (const delta of [
    { headSha: 'abc' },
    { prNumber: 200 },
    { requestFingerprint: 'bad' },
    { dispatcherCaseFingerprint: 'bad' },
    { verdict: 'APPROVED' },
    { receiptChallenge: 'bad' },
    { schemaVersion: 'development-review-receipt.v0' },
  ]) assert.deepEqual(verifiedReceipts([launch(delta), receipt(delta)], pr, allowlist), []);

  assert.deepEqual(verifiedReceipts([receipt()], pr, allowlist), []);
  assert.deepEqual(verifiedReceipts([
    launch({ receiptChallengeHash: 'f'.repeat(64) }),
    receipt(),
  ], pr, allowlist), []);
  assert.deepEqual(verifiedReceipts([launch({ requestFingerprint: 'e'.repeat(64) }), receipt()], pr, allowlist), []);
  assert.deepEqual(verifiedReceipts([launch(), { ...receipt(), commit_id: 'e'.repeat(40) }], pr, allowlist), []);
  assert.deepEqual(verifiedReceipts([launch(), { ...receipt(), body: receipt().body.repeat(2) }], pr, allowlist), []);
  const report = freshnessReport(pr, verifiedReceipts(evidence(), pr, allowlist));
  assert.match(report, /request/);
  assert.match(report, /R2: unknown/);
});

test('authenticated receipt collection preserves current and stale launch-bound evidence before advisory reduction', () => {
  const staleChange = { headSha: 'e'.repeat(40), requestFingerprint: 'f'.repeat(64) };
  const current = { ...receipt(), id: 41, created_at: '2026-09-20T00:00:00Z' };
  const stale = {
    ...receipt(staleChange),
    id: 99,
    created_at: '2026-09-20T00:01:00Z',
    html_url: 'https://github.com/example/repo/pull/201#issuecomment-99',
  };
  const all = authenticatedReceipts([launch(), current, launch(staleChange, { id: 8 }), stale], pr, allowlist);
  assert.equal(all.length, 2);
  assert.equal(all.some((r) => r.freshness === 'current'), true);
  assert.equal(all.some((r) => r.freshness === 'stale'), true);
});

test('cross-endpoint receipt selection uses timestamps before unrelated numeric IDs', () => {
  const staleChange = { headSha: 'e'.repeat(40), requestFingerprint: 'f'.repeat(64) };
  const older = { ...receipt(), id: 999, created_at: '2026-09-20T00:00:00Z' };
  const newer = {
    ...receipt(staleChange),
    id: 1,
    submitted_at: '2026-09-20T00:01:00Z',
    html_url: 'https://github.com/example/repo/pull/201#pullrequestreview-1',
  };
  const selected = verifiedReceipts([launch(), older, launch(staleChange, { id: 8 }), newer], pr, allowlist);
  assert.equal(selected[0].id, 1);
  assert.equal(selected[0].freshness, 'stale');
});
test('publish fence rejects head drift, base drift, closed PR or mismatched PR', () => {
  assert.equal(sameIdentity(pr, structuredClone(pr)), true);
  for (const patch of [{ head: { sha: 'c'.repeat(40) } }, { base: { sha: 'c'.repeat(40) } },
    { number: 200 }, { state: 'closed' }]) assert.equal(sameIdentity(pr, { ...pr, ...patch }), false);
});

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function runAdapter({ mode = 'stale', files = [{ filename: 'src/a.ts' }], comments = evidence(), commentsSequence = null,
  moveAt = 0, event = {}, compare = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-adapter-'));
  try {
    const fixture = { pr: { ...pr, changed_files: files.length, head: { ...pr.head, repo: { full_name: 'owner/repo' } } },
      files, comments, commentsSequence, moveAt, compare };
    const fixtureFile = path.join(dir, 'fixture.json'), log = path.join(dir, 'calls.jsonl');
    writeFileSync(fixtureFile, JSON.stringify(fixture));
    writeFileSync(path.join(dir, 'event.json'), JSON.stringify(event));
    writeFileSync(log, '');
    const mock = path.join(dir, 'mock.mjs');
    writeFileSync(mock, `
      import {readFileSync, appendFileSync} from 'node:fs';
      const f = JSON.parse(readFileSync(process.env.FIXTURE)); let reads = 0, commentReads = 0;
      globalThis.fetch = async (url, options = {}) => {
        const u = new URL(url), method = options.method || 'GET';
        appendFileSync(process.env.CALLS, JSON.stringify({url, method, body: options.body})+'\\n');
        let result;
        if (method !== 'GET') result = {};
        else if (u.pathname.endsWith('/pulls/201')) {
          result = structuredClone(f.pr);
          if (++reads >= f.moveAt && f.moveAt) result.base.sha = 'c'.repeat(40);
        } else if (u.pathname.endsWith('/files')) result = f.files;
        else if (u.pathname.endsWith('/comments')) {
          result = Array.isArray(f.commentsSequence)
            ? f.commentsSequence[Math.min(commentReads++, f.commentsSequence.length - 1)]
            : f.comments;
        }
        else if (u.pathname.endsWith('/reviews')) result = [];
        else if (u.pathname.includes('/compare/')) result = f.compare;
        else throw new Error('Unexpected API '+url);
        return {ok:true, json:async()=>result};
      };
    `);
    const result = spawnSync(process.execPath, ['--import', mock, 'scripts/run-development-audit-gate.mjs', mode], {
      encoding: 'utf8', env: { ...process.env, REPOSITORY: 'owner/repo', PR_NUMBER: '201', GH_TOKEN: 'fixture-only',
        DEVELOPMENT_REVIEWER_ALLOWLIST: JSON.stringify(allowlist), FIXTURE: fixtureFile, CALLS: log,
        GITHUB_EVENT_PATH: path.join(dir, 'event.json'), GITHUB_OUTPUT: path.join(dir, 'output') },
    });
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { ...result, calls };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('adapter makes zero provider calls; metadata/no receipts creates no advisory', () => {
  for (const opts of [{ files: [{ filename: 'TASKS.md' }], comments: [] }, { comments: [] },
    { comments: [launch(), { ...receipt(), user: { login: 'copilot-pull-request-reviewer[bot]' } }] }]) {
    const r = runAdapter(opts);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.calls.every((c) => c.method === 'GET' && c.url.startsWith('https://api.github.com/')));
  }
});
test('adapter refuses to publish after late base drift and replaces legacy false advisory', () => {
  const moved = runAdapter({ moveAt: 3 });
  assert.notEqual(moved.status, 0);
  assert.match(moved.stderr, /Discard advisory/);
  assert.ok(moved.calls.every((c) => c.method === 'GET'));
  const old = { id: 99, user: { login: 'github-actions[bot]' }, body: '<!-- development-stale-review -->\nR1 Copilot current' };
  const retired = runAdapter({ files: [{ filename: 'TASKS.md' }], comments: [old] });
  assert.equal(retired.status, 0, retired.stderr);
  const writes = retired.calls.filter((c) => c.method === 'PATCH');
  assert.equal(writes.length, 1);
  assert.match(JSON.parse(writes[0].body).body, /Withdrawn/);
});
test('adapter refreshes receipt collections immediately before publishing', () => {
  const old = { id: 99, user: { login: 'github-actions[bot]' }, body: '<!-- development-stale-review -->\nold advisory' };
  const arriving = { ...receipt(), created_at: '2026-09-20T00:02:00Z' };
  const r = runAdapter({ comments: [old], commentsSequence: [[old], [old, launch(), arriving]] });
  assert.equal(r.status, 0, r.stderr);
  const writes = r.calls.filter((c) => c.method === 'PATCH');
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].body).body;
  assert.match(body, /R1:/);
  assert.match(body, /freshness current/);
  assert.doesNotMatch(body, /Withdrawn/);
});

test('docs-only delta avoids model calls but still publishes deterministic stale receipt freshness', () => {
  const event = { action: 'synchronize', before: 'd'.repeat(40), pull_request: { head: { sha: head } } };
  const compare = { status: 'ahead', merge_base_commit: { sha: event.before }, files: [{ filename: 'TASKS.md' }] };
  const staleChange = { headSha: event.before, requestFingerprint: 'e'.repeat(64) };
  const staleReceipt = {
    ...receipt(staleChange),
    created_at: '2026-09-20T00:00:00Z',
  };
  const docs = runAdapter({ event, compare, comments: [launch(staleChange), staleReceipt] });
  assert.equal(docs.status, 0, docs.stderr);
  const docsWrites = docs.calls.filter((c) => c.method === 'POST');
  assert.equal(docsWrites.length, 1);
  assert.match(JSON.parse(docsWrites[0].body).body, /freshness stale/);
  assert.ok(docs.calls.every((c) => c.url.startsWith('https://api.github.com/')));

  const diverged = runAdapter({ event, compare: { ...compare, status: 'diverged' } });
  assert.equal(diverged.status, 0, diverged.stderr);
  assert.equal(diverged.calls.filter((c) => c.method === 'POST').length, 1);
});


test('effective-state audit follows code synchronize events through the deterministic classifier', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/development-audits.yml'), 'utf8');
  const section = workflow.split('  effective_state:')[1]?.split('  effective_state_report:')[0] ?? '';
  assert.match(section, /needs\.classify\.outputs\.code == 'true'/);
  assert.match(section, /github\.event\.action == 'synchronize'/);
});


test('effective-state advisory publish revalidates classified head and base', () => {
  const workflow = readFileSync(path.resolve('.github/workflows/development-audits.yml'), 'utf8');
  const section = workflow.split('  effective_state_report:')[1]?.split('  stale_review:')[0] ?? '';
  assert.match(section, /needs: \[classify, effective_state\]/);
  assert.match(section, /CLASSIFIED_HEAD: \$\{\{ needs\.classify\.outputs\.head \}\}/);
  assert.match(section, /CLASSIFIED_BASE: \$\{\{ needs\.classify\.outputs\.base \}\}/);
  assert.match(section, /gh api "repos\/\$\{REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}"/);
  assert.match(section, /Discard Effective State advisory: PR identity moved during audit/);
});
