import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticActionAllowed,
  canonicalTaskBinding,
  classifyPull,
  compactReviewEvidence,
  dispatchNotificationEvents,
  githubPollIntervalSeconds,
  notificationEvent,
  notificationEvents,
  parseTasksSnapshot,
  parseTasksText,
  receiptEvidenceBody,
  reviewReceipts,
  taskReviewRequirements,
  validateQwenChoices,
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

test('TASKS parser exposes row-cap truncation instead of accepting partial authority', () => {
  const source = [
    '| F00-01 | One | X | İncelemede | A | PR #7 |',
    '| F00-02 | Two | X | İncelemede | A | PR #8 |',
  ].join('\n');
  const parsed = parseTasksSnapshot(source, 1);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.truncated, true);
});

test('TASKS parser preserves authoritative evidence beyond 5,000 characters', () => {
  const suffix = 'R2 required';
  const parsed = parseTasksText(`| F00-01 | One | X | İncelemede | A | ${'x'.repeat(5_100)} ${suffix} |`)[0];
  assert.ok(parsed.evidence.endsWith(suffix));
  assert.equal(taskReviewRequirements(parsed).r2, 'required');
});

test('receipt evidence bodies are preserved beyond the former local cutoff', () => {
  const body = `${'x'.repeat(9_000)}\nVERDICT: R2 = BLOCKER`;
  assert.equal(receiptEvidenceBody(body), body);
});

test('TASKS binding requires one row owned by one open pull request', () => {
  const canonical = { id: 'F00-01', prNumbers: [7, 6] };
  assert.equal(canonicalTaskBinding([canonical], [{ number: 7 }], 7).task, canonical);
  assert.equal(canonicalTaskBinding([], [{ number: 7 }], 7).reason, 'TASK_NOT_MAPPED');
  assert.equal(canonicalTaskBinding([
    canonical,
    { id: 'F00-02', prNumbers: [7] },
  ], [{ number: 7 }], 7).reason, 'TASK_BINDING_AMBIGUOUS');
  assert.equal(canonicalTaskBinding([
    canonical,
  ], [{ number: 7 }, { number: 6 }], 7).reason, 'TASK_ROW_SHARED_BY_OPEN_PULLS');
});

test('full TASKS row controls the explicit independent review budget', () => {
  const both = {
    owner: 'Ajan C + R1/R2 + koordinatör kabul',
    evidence: 'PR #7',
    rawLine: '| F00-01 | Test | X | İncelemede | Ajan C + R1/R2 + koordinatör kabul | PR #7 |',
  };
  assert.deepEqual(taskReviewRequirements(both), { r1: 'required', r2: 'required' });
  const r2Only = { ...both, owner: 'Ajan C + R2', rawLine: both.rawLine.replace('R1/R2', 'R2') };
  assert.deepEqual(taskReviewRequirements(r2Only), { r1: 'not_required', r2: 'required' });
  const result = classifyPull(pull({ files: [{ path: 'src/worker/security.ts' }] }), {
    config,
    mainSha: main,
    task: { ...task, ...r2Only },
  });
  assert.deepEqual(result.missingReviews, ['R2']);
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

test('notificationEvents emits all urgent decisions and dispatchNotificationEvents deduplicates', () => {
  const report = {
    decisions: [
      { prNumber: 7, headSha: head, choice: 'B', label: 'REPAIR' },
      { prNumber: 8, headSha: '3'.repeat(40), choice: 'A', label: 'WAIT' },
      { prNumber: 9, headSha: '4'.repeat(40), choice: 'D', label: 'MERGE' },
    ],
  };
  const events = notificationEvents(report);
  assert.equal(events.length, 2);
  assert.equal(events[0].key, `decision:7:${head}:B`);
  assert.equal(events[1].key, `decision:9:${'4'.repeat(40)}:D`);

  const delivered = [];
  const initial = dispatchNotificationEvents(report, {}, (event) => {
    delivered.push(event.key);
    return true;
  }, () => '2026-09-20T20:00:00Z');
  assert.equal(delivered.length, 2);
  assert.equal(Object.keys(initial.ledger).length, 2);

  // Subsequent dispatch with existing ledger should not deliver duplicates
  const secondDelivered = [];
  const next = dispatchNotificationEvents(report, initial.ledger, (event) => {
    secondDelivered.push(event.key);
    return true;
  });
  assert.equal(secondDelivered.length, 0);
  assert.equal(next.delivered.length, 0);
});

test('compactReviewEvidence normalizes review nodes and preserves timestamps and author', () => {
  const node = {
    databaseId: 4056636809,
    author: { login: 'copilot-pull-request-reviewer' },
    state: 'CHANGES_REQUESTED',
    commit: { oid: head },
    body: 'Please fix concurrency limit.',
    submittedAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-20T10:05:00Z',
    url: 'https://github.com/pr/208#review',
  };
  const compact = compactReviewEvidence(node);
  assert.equal(compact.id, 4056636809);
  assert.equal(compact.author, 'copilot-pull-request-reviewer');
  assert.equal(compact.state, 'CHANGES_REQUESTED');
  assert.equal(compact.commitOid, head);
  assert.equal(compact.body, 'Please fix concurrency limit.');
  assert.equal(compact.submittedAt, '2026-09-20T10:00:00Z');
  assert.equal(compact.updatedAt, '2026-09-20T10:05:00Z');
  assert.equal(compact.url, 'https://github.com/pr/208#review');
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

test('review-sourced independent receipt requires native commit identity', () => {
  const r2Pull = pull({
    files: [{ path: 'scripts/browser-flow.mjs' }],
    reviews: [{
      id: 2,
      author: 'integration-reviewer',
      body: `<!-- development-review-receipt ${JSON.stringify({
        role: 'R2', prNumber: 7, headSha: head, baseSha: main,
      })} -->`,
      submittedAt: '2026-01-02',
      url: 'https://github.com/example/repo/pull/7#pullrequestreview-2',
    }],
  });
  assert.equal(reviewReceipts(r2Pull, [], config).r2.status, 'missing');
  r2Pull.reviews[0].commitOid = head;
  assert.equal(reviewReceipts(r2Pull, [], config).r2.status, 'accepted');
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

test('a newer exact-head blocker supersedes an older independent acceptance', () => {
  const reviewed = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  reviewed.comments.push({
    id: 6,
    author: 'integration-reviewer',
    body: `<!-- development-review-receipt ${JSON.stringify({
      role: 'R2', prNumber: 7, headSha: head, baseSha: main,
    })} -->`,
    createdAt: '2026-01-02T00:00:00Z',
    url: 'https://github.com/example/repo/pull/7#issuecomment-6',
  }, {
    id: 7,
    author: 'integration-reviewer',
    commitOid: head,
    body: `VERDICT: R2 = BLOCKER\nREVIEWED SHA: ${head}`,
    createdAt: '2026-01-03T00:00:00Z',
    url: 'https://github.com/example/repo/pull/7#issuecomment-7',
  });
  assert.equal(reviewReceipts(reviewed, [], config).r2.status, 'missing');

  reviewed.comments[1].createdAt = '2026-01-01T00:00:00Z';
  assert.equal(reviewReceipts(reviewed, [], config).r2.status, 'accepted');
});

test('latest exact-head native R0 findings supersede an older clean review', () => {
  const reviewed = pull({ reviews: [{
    id: 10,
    author: 'copilot-pull-request-reviewer[bot]',
    commitOid: head,
    body: '**Findings:** None',
    submittedAt: '2026-01-01T00:00:00Z',
  }, {
    id: 11,
    author: 'copilot-pull-request-reviewer[bot]',
    commitOid: head,
    body: '**Findings:** 1 high',
    submittedAt: '2026-01-02T00:00:00Z',
  }] });
  assert.equal(reviewReceipts(reviewed, [], config).r0.status, 'missing');
  reviewed.reviews[1].body = 'Three unresolved findings remain.\n**Findings:** None';
  assert.equal(reviewReceipts(reviewed, [], config).r0.status, 'missing');
  reviewed.reviews[1].body = '**Findings:** None';
  assert.equal(reviewReceipts(reviewed, [], config).r0.status, 'accepted');
});

test('review-sourced independent blocker requires native commit identity', () => {
  const reviewed = pull({ files: [{ path: 'scripts/browser-flow.mjs' }] });
  reviewed.comments.push({
    id: 12,
    author: 'integration-reviewer',
    body: `<!-- development-review-receipt ${JSON.stringify({
      role: 'R2', prNumber: 7, headSha: head, baseSha: main,
    })} -->`,
    createdAt: '2026-01-01T00:00:00Z',
    url: 'https://github.com/example/repo/pull/7#issuecomment-12',
  });
  reviewed.reviews.push({
    id: 13,
    author: 'integration-reviewer',
    body: `VERDICT: R2 = BLOCKER\nREVIEWED SHA: ${head}`,
    submittedAt: '2026-01-02T00:00:00Z',
    url: 'https://github.com/example/repo/pull/7#pullrequestreview-13',
  });
  assert.equal(reviewReceipts(reviewed, [], config).r2.status, 'accepted');
  reviewed.reviews.at(-1).commitOid = head;
  assert.equal(reviewReceipts(reviewed, [], config).r2.status, 'missing');
});

test('truncated remote evidence blocks an otherwise merge-eligible pull', () => {
  const result = classifyPull(pull(), {
    config,
    mainSha: main,
    task,
    remoteComplete: false,
  });
  assert.equal(result.choice, 'A');
  assert.ok(result.gaps.includes('REMOTE_EVIDENCE_INCOMPLETE'));
  assert.equal(result.mergeEligible, false);
});

test('truncated coordination history blocks only roles that consume it', () => {
  const r0Only = classifyPull(pull(), {
    config,
    mainSha: main,
    task,
    remoteComplete: true,
    coordinationCommentsComplete: false,
  });
  assert.equal(r0Only.choice, 'D');
  assert.ok(!r0Only.gaps.includes('REMOTE_EVIDENCE_INCOMPLETE'));

  const r2Required = classifyPull(pull({
    files: [{ path: 'scripts/browser-flow.mjs' }],
  }), {
    config,
    mainSha: main,
    task,
    remoteComplete: true,
    coordinationCommentsComplete: false,
  });
  assert.equal(r2Required.choice, 'A');
  assert.ok(r2Required.gaps.includes('REMOTE_EVIDENCE_INCOMPLETE'));
  assert.equal(r2Required.mergeEligible, false);
});

test('Qwen response must cover every PR exactly once', () => {
  const decisions = [
    { prNumber: 7, choice: 'C' },
    { prNumber: 8, choice: 'D' },
  ];
  assert.deepEqual(
    validateQwenChoices({ choices: { 8: 'D', 7: 'C' } }, decisions)
      .choices.map(({ prNumber, choice }) => ({ prNumber, choice }))
      .sort((left, right) => left.prNumber - right.prNumber),
    [{ prNumber: 7, choice: 'C' }, { prNumber: 8, choice: 'D' }],
  );
  assert.throws(() => validateQwenChoices({ choices: ['C', 'D'] }, decisions), /explicit prNumber/);
  assert.throws(() => validateQwenChoices({ choices: [
    { prNumber: 7, choice: 'C' },
    { prNumber: 7, choice: 'D' },
  ] }, decisions), /duplicate choice coverage/);
  assert.throws(() => validateQwenChoices({ choices: [
    { prNumber: 7, choice: 'C' },
  ] }, decisions), /1\/2 choices/);
});
