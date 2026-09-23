import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  buildJanitorCandidates,
  hasReviewQuotaSignal,
  janitorDocsOnly,
  janitorFingerprintInput,
  janitorMergedHistoryLimit,
  janitorSystemPrompt,
  janitorTaskKey,
  validateJanitorChoices,
} from '../scripts/qwen-coordinator/janitor.mjs';

const config = {
  janitorEnabled: true,
  docsOnlyPatterns: ['docs/', 'tasks.md', '.md'],
};

function pr(overrides = {}) {
  return {
    number: 248,
    title: 'docs: mark F13-03 handoff accepted on main',
    url: 'https://github.com/example/repo/pull/248',
    headSha: '1'.repeat(40),
    baseSha: '2'.repeat(40),
    draft: true,
    createdAt: '2026-09-21T03:24:46Z',
    updatedAt: '2026-09-21T03:24:46Z',
    files: [{ path: 'docs/handoffs/F13-03.md' }],
    comments: [],
    ...overrides,
  };
}

test('extracts task key from title or handoff path and recognizes docs-only pulls', () => {
  assert.equal(janitorTaskKey(pr()), 'F13-03');
  assert.equal(janitorTaskKey(pr({
    title: 'mechanical closeout',
    files: [{ path: 'docs/handoffs/DEV-ENGINE-07.md' }],
  })), 'DEV-ENGINE-07');
  assert.equal(janitorDocsOnly(pr(), config), true);
  assert.equal(janitorDocsOnly(pr({ files: [{ path: 'src/main.tsx' }] }), config), false);
});

test('older docs PR becomes a superseded candidate when a newer merged PR overlaps the same task and file', () => {
  const remote = {
    mainSha: '9'.repeat(40),
    pulls: [pr()],
    recentMergedPulls: [{
      number: 257,
      title: 'docs: mark F13-03 repair accepted on main',
      url: 'https://github.com/example/repo/pull/257',
      mergedAt: '2026-09-21T05:52:40Z',
      files: [{ path: 'docs/handoffs/F13-03.md' }],
    }],
  };
  const [candidate] = buildJanitorCandidates(remote, config);
  assert.equal(candidate.status, 'SUPERSEDED_CANDIDATE');
  assert.equal(candidate.confidence, 'high');
  assert.equal(candidate.mergedEvidence.prNumber, 257);
  assert.deepEqual(candidate.allowedChoices, ['KEEP', 'CLOSE_CANDIDATE']);
});

test('post-merge closeout opened after the accepted merge is not falsely called superseded', () => {
  const remote = {
    mainSha: '2'.repeat(40),
    pulls: [pr({
      number: 263,
      title: 'docs: mark F13-02 handoff accepted on main',
      createdAt: '2026-09-21T09:26:54Z',
      updatedAt: '2026-09-21T09:26:54Z',
      files: [{ path: 'docs/handoffs/F13-02.md' }],
      baseSha: '2'.repeat(40),
    })],
    recentMergedPulls: [{
      number: 243,
      title: 'F13-02: week status follow-up',
      mergedAt: '2026-09-21T02:00:00Z',
      files: [{ path: 'docs/handoffs/F13-02.md' }],
    }],
  };
  assert.deepEqual(buildJanitorCandidates(remote, config), []);
});

test('older duplicate open docs PR is flagged but remains advisory-only', () => {
  const remote = {
    mainSha: '2'.repeat(40),
    pulls: [
      pr(),
      pr({
        number: 264,
        title: 'docs: refresh F13-03 handoff',
        headSha: '3'.repeat(40),
        createdAt: '2026-09-21T04:00:00Z',
        updatedAt: '2026-09-21T04:00:00Z',
      }),
    ],
    recentMergedPulls: [],
  };
  const candidates = buildJanitorCandidates(remote, config);
  const older = candidates.find((item) => item.prNumber === 248);
  assert.equal(older.status, 'DUPLICATE_CANDIDATE');
  assert.equal(older.duplicateEvidence.prNumber, 264);
  assert.deepEqual(older.allowedChoices, ['KEEP', 'CLOSE_CANDIDATE']);
});

test('Codex review quota message is classified as review-capacity degradation, not a code failure', () => {
  const quotaPull = pr({
    number: 259,
    title: '[F12-05 repair] booking information',
    files: [{ path: 'src/PublicBookingPage.tsx' }],
    comments: [{
      author: 'chatgpt-codex-connector[bot]',
      body: 'You have reached your Codex usage limits for code reviews. Add credits to continue code review.',
    }],
  });
  assert.equal(hasReviewQuotaSignal(quotaPull), true);
  const [candidate] = buildJanitorCandidates({
    mainSha: quotaPull.baseSha,
    pulls: [quotaPull],
    recentMergedPulls: [],
  }, config);
  assert.equal(candidate.status, 'REVIEW_CAPACITY_DEGRADED');
  assert.deepEqual(candidate.allowedChoices, ['KEEP', 'REVIEW_CAPACITY']);
});

test('incomplete or unavailable remote evidence disables Janitor suggestions', () => {
  const remote = {
    available: false,
    complete: false,
    mainSha: '9'.repeat(40),
    pulls: [pr()],
    recentMergedPulls: [{
      number: 257,
      title: 'docs: mark F13-03 repair accepted on main',
      mergedAt: '2026-09-21T05:52:40Z',
      files: [{ path: 'docs/handoffs/F13-03.md' }],
    }],
  };
  assert.deepEqual(buildJanitorCandidates(remote, config), []);
});

test('truncated merged file evidence cannot prove a superseded candidate', () => {
  const remote = {
    mainSha: '2'.repeat(40),
    pulls: [pr({ baseSha: '2'.repeat(40) })],
    recentMergedPulls: [{
      number: 257,
      title: 'docs: mark F13-03 repair accepted on main',
      mergedAt: '2026-09-21T05:52:40Z',
      filesTruncated: true,
      files: [{ path: 'docs/handoffs/F13-03.md' }],
    }],
  };
  assert.deepEqual(buildJanitorCandidates(remote, config), []);
});

test('Qwen janitor response must cover every candidate and cannot exceed deterministic choices', () => {
  const candidates = [
    {
      prNumber: 248,
      allowedChoices: ['KEEP', 'CLOSE_CANDIDATE'],
    },
    {
      prNumber: 259,
      allowedChoices: ['KEEP', 'REVIEW_CAPACITY'],
    },
  ];
  const result = validateJanitorChoices({
    choices: {
      248: 'CLOSE_CANDIDATE',
      259: 'REVIEW_CAPACITY',
    },
  }, candidates);
  assert.deepEqual(
    result.choices.map(({ prNumber, choice }) => ({ prNumber, choice })),
    [
      { prNumber: 248, choice: 'CLOSE_CANDIDATE' },
      { prNumber: 259, choice: 'REVIEW_CAPACITY' },
    ],
  );
  assert.throws(
    () => validateJanitorChoices({ choices: { 248: 'REBASE_CANDIDATE', 259: 'KEEP' } }, candidates),
    /outside the deterministic allowance/,
  );
  assert.throws(
    () => validateJanitorChoices({ choices: { 248: 'KEEP' } }, candidates),
    /1\/2 choices/,
  );
});

test('Janitor fingerprint covers every model-visible candidate field', () => {
  const base = {
    prNumber: 248,
    title: 'docs: close F13-03',
    headSha: '1'.repeat(40),
    taskKey: 'F13-03',
    status: 'SUPERSEDED_CANDIDATE',
    reason: 'newer merged evidence',
    confidence: 'high',
    allowedChoices: ['KEEP', 'CLOSE_CANDIDATE'],
    mergedEvidence: {
      prNumber: 257,
      title: 'F13-03 accepted',
      mergedAt: '2026-09-21T05:52:40Z',
      overlapFiles: ['docs/handoffs/F13-03.md'],
      url: 'https://github.com/example/repo/pull/257',
    },
    duplicateEvidence: null,
  };
  const fingerprint = (candidate) => JSON.stringify(janitorFingerprintInput([candidate]));
  const original = fingerprint(base);
  for (const changed of [
    { ...base, title: 'docs: close F13-03 corrected' },
    { ...base, reason: 'different deterministic reason' },
    { ...base, mergedEvidence: { ...base.mergedEvidence, title: 'different merged title' } },
    { ...base, mergedEvidence: { ...base.mergedEvidence, url: 'https://github.com/example/repo/pull/999' } },
  ]) {
    assert.notEqual(fingerprint(changed), original);
  }

  const duplicate = {
    ...base,
    mergedEvidence: null,
    duplicateEvidence: {
      prNumber: 264,
      title: 'newer duplicate',
      url: 'https://github.com/example/repo/pull/264',
    },
  };
  const duplicateOriginal = fingerprint(duplicate);
  assert.notEqual(
    fingerprint({ ...duplicate, duplicateEvidence: { ...duplicate.duplicateEvidence, title: 'renamed duplicate' } }),
    duplicateOriginal,
  );
  assert.notEqual(
    fingerprint({ ...duplicate, duplicateEvidence: { ...duplicate.duplicateEvidence, url: 'https://github.com/example/repo/pull/265' } }),
    duplicateOriginal,
  );
});

test('Janitor merged-history window is normalized and hard-capped at 20', () => {
  assert.equal(janitorMergedHistoryLimit(20), 20);
  assert.equal(janitorMergedHistoryLimit(7), 7);
  assert.equal(janitorMergedHistoryLimit(1000), 20);
  assert.equal(janitorMergedHistoryLimit(0), 20);
  assert.equal(janitorMergedHistoryLimit(-1), 20);
  assert.equal(janitorMergedHistoryLimit('invalid'), 20);
  assert.equal(janitorMergedHistoryLimit(2.5), 20);
});

test('integrated coordinator source remains syntactically valid', () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', 'scripts/qwen-coordinator/run-once.mjs'], {
      stdio: 'pipe',
    });
  });
});

test('janitor prompt lists every candidate key instead of a copyable example', () => {
  const prompt = janitorSystemPrompt([{ prNumber: 236 }, { prNumber: 248 }, { prNumber: 267 }]);
  assert.match(prompt, /toplam 3 anahtar: 236, 248, 267\./);
  assert.doesNotMatch(prompt, /"\d+":"[A-Z_]+"/);
});
