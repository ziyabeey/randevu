import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildJanitorCandidates,
  hasReviewQuotaSignal,
  janitorDocsOnly,
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
