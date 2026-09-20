import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticActionAllowed,
  classifyPull,
  githubPollIntervalSeconds,
  notificationEvent,
  parseTasksText,
  reviewReceipts,
} from '../scripts/qwen-coordinator/policy.mjs';

const head = '1'.repeat(40);
const main = '2'.repeat(40);
const config = {
  requiredCheckName: 'CI gate',
  docsOnlyPatterns: ['docs/', 'tasks.md', '.md'],
  r1PathPatterns: ['supabase/migrations/', 'src/worker'],
  r2PathPatterns: ['scripts/browser-', 'tests/browser/', 'page.tsx'],
  trustedReceiptActorsByRole: {
    R1: ['security-reviewer'],
    R2: ['integration-reviewer'],
  },
};

function pull(overrides = {}) {
  return {
    number: 7,
    author: 'owner',
    draft: false,
    headSha: head,
    baseSha: main,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    fromFork: false,
    files: [{ path: 'src/example.ts', additions: 1, deletions: 0 }],
    filesTruncated: false,
    threadsTruncated: false,
    unresolvedThreads: 0,
    checks: [{
      type: 'CheckRun',
      name: 'CI gate',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      completedAt: '2026-01-01',
    }],
    reviews: [{
      id: 1,
      author: 'copilot-pull-request-reviewer[bot]',
      commitOid: head,
      body: '**Findings:** None',
      submittedAt: '2026-01-01',
    }],
    comments: [],
    ...overrides,
  };
}

const task = { id: 'F00-01', status: 'İncelemede', evidence: 'PR #7' };

test('TASKS parser recognizes product and DEV-ENGINE rows', () => {
  assert.equal(parseTasksText('| [F00-01](x) | Test | X | İncelemede | A | PR #7 |')[0].id, 'F00-01');
  assert.equal(parseTasksText('| DEV-ENGINE-07 | Test | X | Çalışılıyor | A | PR #207 |')[0].id, 'DEV-ENGINE-07');
});

test('automatic action allowlist is explicit and fail-closed', () => {
  assert.equal(automaticActionAllowed({}, 'MERGE'), false);
  assert.equal(automaticActionAllowed({
    allowedAutomaticActions: ['merge_after_all_hard_gates'],
  }, 'MERGE'), true);
  assert.equal(automaticActionAllowed({
    allowedAutomaticActions: ['merge_after_all_hard_gates'],
  }, 'DISPATCH_REVIEW'), false);
  assert.equal(automaticActionAllowed({
    allowedAutomaticActions: ['unknown-capability'],
  }, 'UNKNOWN'), false);
});

test('polling treats only TASKS-mapped CI as active and backs off near rate limits', () => {
  const state = {
    remoteCache: {
      rateLimitRemaining: 4000,
      tasks: [{ prNumbers: [7] }],
      pulls: [
        { number: 7, checks: [{ name: 'CI gate', status: 'COMPLETED' }] },
        { number: 99, checks: [{ name: 'CI gate', status: 'IN_PROGRESS' }] },
      ],
    },
    depotRuns: {},
  };
  const pollConfig = {
    requiredCheckName: 'CI gate',
    githubAuthenticatedPollSeconds: 60,
    githubActivePollSeconds: 30,
  };
  assert.equal(githubPollIntervalSeconds(state, pollConfig), 60);
  state.remoteCache.pulls[0].checks[0].status = 'IN_PROGRESS';
  assert.equal(githubPollIntervalSeconds(state, pollConfig), 30);
  state.remoteCache.rateLimitRemaining = 900;
  assert.equal(githubPollIntervalSeconds(state, pollConfig), 300);
  state.remoteCache.rateLimitRemaining = 200;
  assert.equal(githubPollIntervalSeconds(state, pollConfig), 900);
});

test('notification identity ignores unrelated report fingerprints', () => {
  const report = {
    fingerprint: 'first',
    decisions: [{ prNumber: 7, headSha: head, choice: 'B', label: 'REPAIR' }],
  };
  const first = notificationEvent(report);
  const second = notificationEvent({ ...report, fingerprint: 'unrelated-change' });
  assert.equal(first.key, second.key);
  assert.notEqual(notificationEvent({
    ...report,
    decisions: [{ ...report.decisions[0], headSha: '3'.repeat(40) }],
  }).key, first.key);
  assert.notEqual(notificationEvent({
    ...report,
    decisions: [{ ...report.decisions[0], choice: 'D', label: 'MERGE' }],
  }).key, first.key);
});

test('deterministic failures and conflicts can never become merge advice', () => {
  assert.equal(classifyPull(pull({
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
  }), { config, mainSha: main, task }).choice, 'B');
  assert.equal(classifyPull(pull({
    checks: [{ type: 'CheckRun', name: 'CI gate', status: 'COMPLETED', conclusion: 'FAILURE' }],
  }), { config, mainSha: main, task }).choice, 'B');
  assert.equal(classifyPull(pull({ unresolvedThreads: 1 }), { config, mainSha: main, task }).choice, 'B');
});

test('draft and missing independent receipt remain in review', () => {
  assert.equal(classifyPull(pull({ draft: true }), { config, mainSha: main, task }).choice, 'C');
  const r2Pull = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  assert.equal(classifyPull(r2Pull, { config, mainSha: main, task }).choice, 'C');
  assert.deepEqual(classifyPull(r2Pull, { config, mainSha: main, task }).missingReviews, ['R2']);
});

test('exact structured role receipt can close only its allowlisted role', () => {
  const r2Pull = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  r2Pull.comments.push({
    id: 2,
    author: 'integration-reviewer',
    body: `<!-- development-review-receipt ${JSON.stringify({
      role: 'R2', prNumber: 7, headSha: head, baseSha: main,
    })} -->`,
    createdAt: '2026-01-02',
    url: 'https://github.com/example/repo/pull/7#issuecomment-2',
  });
  assert.equal(classifyPull(r2Pull, { config, mainSha: main, task }).choice, 'D');
});

test('stale, prose-only and generic-bot specialist receipts fail closed', () => {
  const stale = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  stale.comments.push({
    id: 3,
    author: 'integration-reviewer',
    body: `<!-- development-review-receipt ${JSON.stringify({
      role: 'R2', prNumber: 7, headSha: '3'.repeat(40), baseSha: main,
    })} -->`,
    url: 'https://github.com/example/repo/pull/7#issuecomment-3',
  });
  assert.equal(reviewReceipts(stale, [], config).r2.status, 'missing');

  const prose = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  prose.comments.push({
    id: 4,
    author: 'integration-reviewer',
    body: `VERDICT: R2 = ACCEPTABLE\nREVIEWED SHA: ${head}`,
    url: 'https://github.com/example/repo/pull/7#issuecomment-4',
  });
  assert.equal(reviewReceipts(prose, [], config).r2.status, 'missing');

  const generic = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  generic.comments.push({
    id: 5,
    author: 'copilot-pull-request-reviewer[bot]',
    body: `<!-- development-review-receipt ${JSON.stringify({
      role: 'R2', prNumber: 7, headSha: head, baseSha: main,
    })} -->`,
    url: 'https://github.com/example/repo/pull/7#issuecomment-5',
  });
  assert.equal(reviewReceipts(generic, [], {
    ...config,
    trustedReceiptActorsByRole: {
      R1: ['security-reviewer'],
      R2: ['copilot-pull-request-reviewer[bot]'],
    },
  }).r2.status, 'missing');
});
