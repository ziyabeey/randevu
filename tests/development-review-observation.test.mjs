import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildDevelopmentReviewObservation,
  findTaskBinding,
  reviewRequirementsFromTaskRow,
  selectCurrentSuccessfulCiRun,
} from '../scripts/prepare-development-review-observation.mjs';

const repository = 'ziyabeey/randevu';
const sha = (char) => char.repeat(40);
const head = sha('a');
const main = sha('b');
const oldHead = sha('c');
const merge = sha('d');
const caseFp = 'e'.repeat(64);
const requestFp = 'f'.repeat(64);
const challenge = '1'.repeat(64);
const challengeHash = createHash('sha256').update(challenge).digest('hex');

function pr(overrides = {}) {
  return {
    number: 187,
    state: 'open',
    draft: false,
    merge_commit_sha: merge,
    user: { login: 'implementer' },
    head: {
      sha: head,
      ref: 'f12-05-public-group-booking',
      repo: { full_name: repository },
    },
    base: { sha: main, ref: 'main' },
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    id: 100,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/ci.yml',
    head_sha: head,
    run_attempt: 1,
    created_at: '2026-09-19T18:00:00Z',
    html_url: `https://github.com/${repository}/actions/runs/100`,
    pull_requests: [{ number: 187 }],
    ...overrides,
  };
}

function tasks(evidence = 'Codex + R0/R2 · bağımsız exact-SHA R2 bekleniyor') {
  return [
    '| Kimlik | İş | Önkoşullar | Durum | Sahip / UTC güncelleme | Kanıt / engel |',
    '| --- | --- | --- | --- | --- | --- |',
    `| [F12-05](docs/plan/phase-12.md#f12-05) | Public booking | F12-04 | İncelemede | Codex + R0/R2 | [PR #187](https://github.com/${repository}/pull/187) · ${evidence} |`,
  ].join('\n');
}

function r0Review(body = '<!-- ccr-overview-v2 -->\n**Findings:** None') {
  return {
    id: 500,
    submitted_at: '2026-09-19T18:10:00Z',
    commit_id: head,
    body,
    user: { login: 'copilot-pull-request-reviewer[bot]' },
  };
}

function r2Receipt(reviewedHead = oldHead, verdict = 'ACCEPTABLE', reviewedBase = main, requestFingerprint = requestFp, receiptChallenge = challenge) {
  return {
    id: 600,
    created_at: '2026-09-19T17:00:00Z',
    html_url: `https://github.com/${repository}/pull/187#issuecomment-600`,
    body: `<!-- development-review-receipt ${JSON.stringify({
      schemaVersion: 'development-review-receipt.v1',
      role: 'R2',
      prNumber: 187,
      headSha: reviewedHead,
      baseSha: reviewedBase,
      dispatcherCaseFingerprint: caseFp,
      requestFingerprint,
      receiptChallenge,
      verdict,
    })} -->`,
    user: { login: 'claude[bot]' },
    author_association: 'NONE',
  };
}

function r2Launch(reviewedHead = oldHead, reviewedBase = main, requestFingerprint = requestFp, receiptChallengeHash = challengeHash) {
  return {
    id: 590,
    created_at: '2026-09-19T16:59:00Z',
    html_url: `https://github.com/${repository}/pull/187#issuecomment-590`,
    user: { login: 'github-actions[bot]' },
    body: [
      `<!-- development-review-launch:v1:r2:${requestFingerprint} -->`,
      '## Development R2 Routine launch',
      '- status: ROUTINE_TRIGGERED',
      `- exact head: ${reviewedHead}`,
      `- base main: ${reviewedBase}`,
      `- dispatcher case: ${caseFp}`,
      `- role request: ${requestFingerprint}`,
      `- receipt challenge hash: ${receiptChallengeHash}`,
    ].join('\n'),
  };
}

function input(overrides = {}) {
  return {
    repository,
    tasksText: tasks(),
    pr: pr(),
    main: { commit: { sha: main } },
    runs: { workflow_runs: [run()] },
    jobs: { jobs: [{ id: 200, name: 'CI gate', status: 'completed', conclusion: 'success', run_attempt: 1 }] },
    prReviews: [r0Review()],
    prComments: [r2Launch(), r2Receipt()],
    coordinationComments: [],
    reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
    reviewThreads: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        },
      },
    },
    observedAt: '2026-09-19T18:11:00Z',
    ...overrides,
  };
}

test('selects only a successful current-head PR CI run bound to the exact PR', () => {
  const selected = selectCurrentSuccessfulCiRun({ workflow_runs: [
    run({ id: 98, head_sha: oldHead }),
    run({ id: 99, conclusion: 'failure' }),
    run(),
  ] }, pr());
  assert.equal(selected.id, 100);
  assert.equal(selectCurrentSuccessfulCiRun({ workflow_runs: [run({ pull_requests: [{ number: 999 }] })] }, pr()), null);
});

test('canonical TASKS binding controls the explicit R1/R2 review budget', () => {
  const binding = findTaskBinding(tasks(), repository, 187);
  assert.equal(binding.id, 'F12-05');
  assert.deepEqual(reviewRequirementsFromTaskRow(binding.line), { r1: 'not_required', r2: 'required' });
  assert.deepEqual(
    reviewRequirementsFromTaskRow('| DEV | no R1 · R2 gerekmez |'),
    { r1: 'not_required', r2: 'not_required' },
  );
  assert.deepEqual(reviewRequirementsFromTaskRow('| DEV | no explicit review budget |'), {
    r1: 'unknown',
    r2: 'unknown',
  });
});

test('current green CI plus clean R0 routes only the stale required R2 receipt', () => {
  const built = buildDevelopmentReviewObservation(input());
  assert.equal(built.observation.task.id, 'F12-05');
  assert.equal(built.observation.ci.run, '100');
  assert.equal(built.observation.ci.job, '200');
  assert.equal(built.observation.ci.testedCheckoutSha, head);
  assert.equal(built.observation.ci.explicitlyBoundToHead, false);
  assert.equal(built.observation.r0.freeze, 'none');
  assert.equal(built.observation.reviews.r1.requirement, 'not_required');
  assert.equal(built.observation.reviews.r2.reviewedHeadSha, oldHead);
  assert.equal(built.observation.reviews.r2.reviewedBaseSha, main);
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'request_required_reviews');
  assert.deepEqual(built.dispatcher.recommendation.eligibleRoles, ['r2']);
  assert.equal(built.evidence.materialFacts.priorReviewReceipts.r2.endsWith('#issuecomment-600'), true);
});

test('a current acceptable R2 receipt is never re-fired', () => {
  const built = buildDevelopmentReviewObservation(input({ prComments: [r2Launch(head), r2Receipt(head)] }));
  assert.equal(built.dispatcher.state.reviews.r2.status, 'acceptable_current');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'assess_current_evidence');
  assert.deepEqual(built.dispatcher.recommendation.eligibleRoles, []);
});

test('a newer stale receipt cannot shadow an existing current receipt', () => {
  const current = {
    ...r2Receipt(head, 'ACCEPTABLE', main),
    id: 601,
    created_at: '2026-09-19T17:00:00Z',
    html_url: `https://github.com/${repository}/pull/187#issuecomment-601`,
  };
  const delayedStale = {
    ...r2Receipt(oldHead, 'INCOMPLETE', oldHead, '1'.repeat(64)),
    id: 999,
    created_at: '2026-09-19T19:00:00Z',
    html_url: `https://github.com/${repository}/pull/187#issuecomment-999`,
  };
  const built = buildDevelopmentReviewObservation(input({
    prComments: [
      r2Launch(head, main, requestFp),
      current,
      r2Launch(oldHead, oldHead, '1'.repeat(64)),
      delayedStale,
    ],
  }));
  assert.equal(built.observation.reviews.r2.reviewedHeadSha, head);
  assert.equal(built.observation.reviews.r2.reviewedBaseSha, main);
  assert.equal(built.observation.reviews.r2.sourceRef.endsWith('#issuecomment-601'), true);
  assert.equal(built.dispatcher.state.reviews.r2.status, 'acceptable_current');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'assess_current_evidence');
});

test('equal-time conflicting current receipts fail closed instead of using cross-endpoint IDs', () => {
  const secondRequest = '2'.repeat(64);
  const first = {
    ...r2Receipt(head, 'INCOMPLETE', main, requestFp),
    id: 900,
    created_at: '2026-09-19T20:00:00Z',
    html_url: `https://github.com/${repository}/pull/187#issuecomment-900`,
  };
  const second = {
    ...r2Receipt(head, 'ACCEPTABLE', main, secondRequest),
    id: 2,
    created_at: undefined,
    submitted_at: '2026-09-19T20:00:00Z',
    commit_id: head,
    html_url: `https://github.com/${repository}/pull/187#pullrequestreview-2`,
  };
  const built = buildDevelopmentReviewObservation(input({
    prComments: [
      r2Launch(head, main, requestFp),
      first,
      r2Launch(head, main, secondRequest),
    ],
    prReviews: [r0Review(), second],
  }));
  assert.equal(built.observation.reviews.r2.receipt, 'unknown');
  assert.equal(built.observation.reviews.r2.verdict, 'unknown');
  assert.notEqual(built.dispatcher.recommendation.suggestedAction, 'assess_current_evidence');
});

test('prose or unallowlisted commenters cannot forge an independent review receipt', () => {
  const prose = {
    ...r2Receipt(head),
    body: `## R2 FINAL\nExact head: \`${head}\`\nVerdict: **ACCEPTABLE**`,
  };
  const proseBuilt = buildDevelopmentReviewObservation(input({ prComments: [r2Launch(head), prose] }));
  assert.equal(proseBuilt.observation.reviews.r2.receipt, 'missing');
  assert.equal(proseBuilt.dispatcher.recommendation.suggestedAction, 'request_required_reviews');

  const stranger = { ...r2Receipt(head), user: { login: 'stranger' } };
  const strangerBuilt = buildDevelopmentReviewObservation(input({ prComments: [r2Launch(head), stranger] }));
  assert.equal(strangerBuilt.observation.reviews.r2.receipt, 'missing');
  assert.equal(strangerBuilt.dispatcher.recommendation.suggestedAction, 'request_required_reviews');
});

test('Issue #65 coordination comments cannot satisfy independent review receipts', () => {
  const built = buildDevelopmentReviewObservation(input({
    prComments: [r2Launch(head)],
    coordinationComments: [r2Receipt(head)],
  }));
  assert.equal(built.observation.reviews.r2.receipt, 'missing');
  assert.equal(built.observation.reviews.r2.verdict, 'pending');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'request_required_reviews');
});

test('same-head receipt from an older base remains stale and cannot suppress review', () => {
  const built = buildDevelopmentReviewObservation(input({
    prComments: [r2Launch(head, oldHead), r2Receipt(head, 'ACCEPTABLE', oldHead)],
  }));
  assert.equal(built.observation.reviews.r2.reviewedHeadSha, head);
  assert.equal(built.observation.reviews.r2.reviewedBaseSha, oldHead);
  assert.equal(built.dispatcher.state.reviews.r2.status, 'stale');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'request_required_reviews');
});

test('R0 findings stop independent review delivery before any Routine credential is used', () => {
  const built = buildDevelopmentReviewObservation(input({
    prReviews: [r0Review('<!-- ccr-overview-v2 -->\n**Findings:** 1 high')],
  }));
  assert.equal(built.observation.r0.freeze, 'blockers');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'repair_frozen_r0_blockers');
});

test('a contradictory native no-findings overview with unresolved issues fails closed', () => {
  const built = buildDevelopmentReviewObservation(input({
    prReviews: [r0Review('<!-- ccr-overview-v2 -->\nThree moderate unresolved issues remain.\n**Findings:** None')],
  }));
  assert.equal(built.observation.r0.freeze, 'blockers');
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'repair_frozen_r0_blockers');
});

test('an unresolved non-outdated review thread blocks Routine delivery', () => {
  const built = buildDevelopmentReviewObservation(input({
    reviewThreads: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [{ id: 'PRRT_open', isResolved: false, isOutdated: false }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    },
  }));
  assert.deepEqual(built.observation.r0.frozenBlockers, ['R0-THREAD-PRRT_open']);
  assert.equal(built.dispatcher.recommendation.suggestedAction, 'repair_frozen_r0_blockers');
});

test('draft and fork candidates fail closed at the trusted automation boundary', () => {
  assert.throws(
    () => buildDevelopmentReviewObservation(input({ pr: pr({ draft: true }) })),
    /PR_NOT_ACTIVE/,
  );
  assert.throws(
    () => buildDevelopmentReviewObservation(input({
      pr: pr({ head: { sha: head, ref: 'fork', repo: { full_name: 'outside/fork' } } }),
    })),
    /PR_TRUST_BOUNDARY_INVALID/,
  );
});
