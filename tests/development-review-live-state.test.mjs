import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  checkoutShaFromJobLogs,
  normalizeLiveReviewIdentity,
  taskPrNumbersFromRow,
  verifyDevelopmentReviewLiveState,
  verifyTaskBinding,
} from '../scripts/verify-development-review-live-state.mjs';

const sha = (char) => char.repeat(40);
const head = sha('a');
const main = sha('b');
const merge = sha('c');
const caseFp = 'd'.repeat(64);
const requestFp = 'e'.repeat(64);
const challenge = 'f'.repeat(64);
const challengeHash = createHash('sha256').update(challenge).digest('hex');

function request(overrides = {}) {
  return {
    schemaVersion: 'development-independent-review-request.v0',
    role: 'r2',
    case: {
      task: 'F13-01',
      pr: 183,
      currentHead: head,
      baseMain: main,
      currentMain: main,
      ...(overrides.case ?? {}),
    },
    currentEvidence: {
      ci: {
        status: 'pass',
        exactHeadSha: head,
        testedCheckoutSha: head,
        explicitlyBoundToHead: false,
        baseMainSha: main,
        run: '100',
        job: '200',
        attempt: 1,
        ...(overrides.ci ?? {}),
      },
    },
  };
}

function reviewReceipt({
  id = 300,
  verdict = 'ACCEPTABLE',
  requestFingerprint = requestFp,
  dispatcherCaseFingerprint = caseFp,
  receiptChallenge = challenge,
  url = 'https://github.com/ziyabeey1-ai/randevu/pull/183#issuecomment-300',
  timestamp = '2026-09-20T00:03:00Z',
  review = false,
} = {}) {
  return {
    id,
    html_url: url,
    ...(review ? { submitted_at: timestamp, commit_id: head } : { created_at: timestamp }),
    user: { login: 'claude[bot]' },
    body: `<!-- development-review-receipt ${JSON.stringify({
      schemaVersion: 'development-review-receipt.v1',
      role: 'R2',
      prNumber: 183,
      headSha: head,
      baseSha: main,
      dispatcherCaseFingerprint,
      requestFingerprint,
      receiptChallenge,
      verdict,
    })} -->`,
  };
}

function reviewLaunch({
  id = 250,
  requestFingerprint = requestFp,
  dispatcherCaseFingerprint = caseFp,
  url = 'https://github.com/ziyabeey1-ai/randevu/pull/183#issuecomment-250',
} = {}) {
  return {
    id,
    html_url: url,
    created_at: '2026-09-20T00:02:00Z',
    user: { login: 'github-actions[bot]' },
    body: [
      `<!-- development-review-launch:v1:r2:${requestFingerprint} -->`,
      '## Development R2 Routine launch',
      '- status: ROUTINE_TRIGGERED',
      `- exact head: ${head}`,
      `- base main: ${main}`,
      `- dispatcher case: ${dispatcherCaseFingerprint}`,
      `- role request: ${requestFingerprint}`,
      `- receipt challenge hash: ${challengeHash}`,
    ].join('\n'),
  };
}

function tasks(pr = 183) {
  return [
    '| Kimlik | İş | Önkoşullar | Durum | Sahip | Kanıt |',
    '| --- | --- | --- | --- | --- | --- |',
    `| [F13-01](docs/plan/phase-13.md#f13-01) | Takvim | F11-03 | İncelemede | Koordinatör | [PR #${pr}](https://github.com/ziyabeey1-ai/randevu/pull/${pr}) |`,
  ].join('\n');
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function liveFetch(overrides = {}) {
  return async (url) => {
    if (url.endsWith('/pulls/183')) {
      return response({
        number: 183,
        state: 'open',
        user: { login: 'implementer' },
        head: { sha: overrides.liveHead ?? head },
        base: { sha: main },
      });
    }
    if (url.endsWith('/branches/main')) {
      return response({ commit: { sha: overrides.liveMain ?? main } });
    }
    if (url.endsWith('/actions/runs/100')) {
      return response({
        id: 100,
        head_sha: head,
        status: 'completed',
        conclusion: overrides.runConclusion ?? 'success',
        run_attempt: 1,
        event: overrides.runEvent ?? 'pull_request',
        pull_requests: overrides.pullRequests ?? [{ number: 183 }],
        path: '.github/workflows/ci.yml',
      });
    }
    if (url.includes('/actions/runs/100/attempts/1/jobs?')) {
      return response({
        jobs: [{
          id: 200,
          name: 'CI gate',
          status: 'completed',
          conclusion: overrides.jobConclusion ?? 'success',
          run_attempt: overrides.jobAttempt ?? 1,
        }],
      });
    }
    if (url.endsWith('/actions/jobs/200/logs')) {
      const checkoutSha = overrides.checkoutSha ?? head;
      return response([
        '2026-09-20T00:00:00.0000000Z [command]/usr/bin/git log -1 --format=%H',
        `2026-09-20T00:00:00.0000001Z ${checkoutSha}`,
      ].join('\n'));
    }
    if (url.includes('/issues/183/comments?')) return response(overrides.comments ?? []);
    if (url.includes('/pulls/183/reviews?')) return response(overrides.reviews ?? []);
    if (url.includes('/issues/65/comments?')) return response(overrides.coordinationComments ?? []);
    throw new Error(`unexpected URL: ${url}`);
  };
}

test('checkout log parser returns one exact checkout SHA and rejects ambiguity', () => {
  const log = [
    '2026-09-20T00:00:00.0000000Z [command]/usr/bin/git log -1 --format=%H',
    `2026-09-20T00:00:00.0000001Z ${merge}`,
  ].join('\n');
  assert.equal(checkoutShaFromJobLogs(log), merge);
  assert.equal(checkoutShaFromJobLogs(`${log}\n2026-09-20T00:00:01Z [command]/usr/bin/git log -1 --format=%H\n2026-09-20T00:00:02Z ${head}`), null);
});

test('normalization keeps exact task candidate and CI identity', () => {
  const identity = normalizeLiveReviewIdentity(request());
  assert.equal(identity.task, 'F13-01');
  assert.equal(identity.pr, 183);
  assert.equal(identity.head, head);
  assert.equal(identity.ci.run, '100');
  assert.equal(identity.ci.job, '200');
  assert.equal(identity.ci.attempt, 1);
});

test('canonical TASKS must bind the exact task to the exact PR', () => {
  const identity = normalizeLiveReviewIdentity(request());
  assert.match(verifyTaskBinding(tasks(), identity, 'ziyabeey1-ai/randevu'), /F13-01/);
  assert.deepEqual(taskPrNumbersFromRow(tasks(), 'ziyabeey1-ai/randevu'), [183]);
  assert.deepEqual(
    taskPrNumbersFromRow('| [F13-01](x) | https://github.com/ziyabeey1-ai/randevu/pull/1830 |', 'ziyabeey1-ai/randevu'),
    [1830],
  );
  assert.throws(
    () => verifyTaskBinding(tasks(999), identity, 'ziyabeey1-ai/randevu'),
    /TASK_PR_BINDING_MISSING/,
  );
  assert.throws(
    () => verifyTaskBinding('| [F13-02](x) | other |', identity, 'ziyabeey1-ai/randevu'),
    /TASK_NOT_IN_CANONICAL_TASKS/,
  );
});

test('live verifier accepts only matching task PR main and successful exact CI', async () => {
  const result = await verifyDevelopmentReviewLiveState(request(), {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    fetchImpl: liveFetch(),
    git() { throw new Error('raw-head proof must not fetch merge ref'); },
  });
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
  assert.equal(result.checkoutBinding, 'raw_head');
  assert.equal(result.ciRun, '100');
});

test('live verifier rejects stale PR identity and failed CI', async () => {
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ liveHead: sha('d') }),
    }),
    /LIVE_PR_IDENTITY_MISMATCH/,
  );
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ runConclusion: 'failure' }),
    }),
    /LIVE_CI_RUN_MISMATCH/,
  );
});


test('live verifier rejects manually dispatched or wrong-PR CI evidence', async () => {
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ runEvent: 'workflow_dispatch' }),
    }),
    /LIVE_CI_RUN_MISMATCH/,
  );
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ pullRequests: [{ number: 999 }] }),
    }),
    /LIVE_CI_RUN_MISMATCH/,
  );
});

test('live verifier binds the CI gate job to the requested run attempt', async () => {
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ jobAttempt: 2 }),
    }),
    /LIVE_CI_JOB_MISMATCH/,
  );
});

test('canonical task binding refuses a second open PR referenced by the same task row', async () => {
  const taskText = [
    '| Kimlik | İş | Önkoşullar | Durum | Sahip | Kanıt |',
    '| --- | --- | --- | --- | --- | --- |',
    '| [F13-01](docs/plan/phase-13.md#f13-01) | Takvim | F11-03 | İncelemede | Koordinatör | [PR #183](https://github.com/ziyabeey1-ai/randevu/pull/183) · [old PR #190](https://github.com/ziyabeey1-ai/randevu/pull/190) |',
  ].join('\n');
  const fetchImpl = async (url) => {
    if (url.endsWith('/pulls/190')) return response({ state: 'open', head: { sha: sha('e') }, base: { sha: main } });
    return liveFetch()(url);
  };
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: taskText,
      fetchImpl,
    }),
    /TASK_OPEN_PR_BINDING_AMBIGUOUS/,
  );
});

test('bound merge-ref checkout is revalidated against the live PR merge ref', async () => {
  const calls = [];
  const result = await verifyDevelopmentReviewLiveState(request({
    ci: { testedCheckoutSha: merge, explicitlyBoundToHead: true },
  }), {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    fetchImpl: liveFetch({ checkoutSha: merge }),
    git(args) {
      calls.push(args);
      if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: merge + '\n', stderr: '' };
      throw new Error('unexpected git call');
    },
  });
  assert.equal(result.checkoutBinding, 'live_merge_ref');
  assert.deepEqual(calls[0].slice(-2), ['origin', 'refs/pull/183/merge']);
});

test('claimed tested checkout must equal the checkout recorded by the cited CI job', async () => {
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request({
      ci: { testedCheckoutSha: merge, explicitlyBoundToHead: true },
    }), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ checkoutSha: head }),
    }),
    /LIVE_CI_TESTED_CHECKOUT_MISMATCH/,
  );
});

test('a current authenticated same-role receipt stops Routine spend before reservation or fire', async () => {
  const receipt = reviewReceipt();
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request(), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
      fetchImpl: liveFetch({ comments: [reviewLaunch(), receipt] }),
    }),
    /R2_REVIEW_ALREADY_RECEIVED/,
  );
});

test('represented current INCOMPLETE receipt does not block its FOLLOW_UP, but newer current evidence does', async () => {
  const represented = reviewReceipt({ verdict: 'INCOMPLETE' });
  const followUp = request();
  followUp.reviewMode = 'FOLLOW_UP';
  followUp.currentEvidence.review = {
    previousReviewedHeadSha: head,
    previousReviewedBaseSha: main,
    previousReceiptSourceRef: represented.html_url,
    previousReceiptObservedAt: Date.parse(represented.created_at),
    previousReceiptId: represented.id,
  };
  const result = await verifyDevelopmentReviewLiveState(followUp, {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
    fetchImpl: liveFetch({ comments: [reviewLaunch(), represented] }),
    git() { throw new Error('raw-head proof must not fetch merge ref'); },
  });
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');

  const newerRequest = 'f'.repeat(64);
  const newer = reviewReceipt({
    id: 301,
    verdict: 'ACCEPTABLE',
    requestFingerprint: newerRequest,
    timestamp: '2026-09-20T00:04:00Z',
    url: 'https://github.com/ziyabeey1-ai/randevu/pull/183#issuecomment-301',
  });
  await assert.rejects(
    verifyDevelopmentReviewLiveState(followUp, {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
      fetchImpl: liveFetch({ comments: [
        reviewLaunch(),
        represented,
        reviewLaunch({ id: 251, requestFingerprint: newerRequest }),
        newer,
      ] }),
    }),
    /R2_REVIEW_ALREADY_RECEIVED/,
  );
});

test('coordination Issue #65 cannot satisfy the v1 final review authority', async () => {
  const receipt = reviewReceipt({
    id: 400,
    url: 'https://github.com/ziyabeey1-ai/randevu/issues/65#issuecomment-400',
    timestamp: '2026-09-20T00:05:00Z',
  });
  const result = await verifyDevelopmentReviewLiveState(request(), {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
    fetchImpl: liveFetch({ comments: [reviewLaunch()], coordinationComments: [receipt] }),
    git() { throw new Error('raw-head proof must not fetch merge ref'); },
  });
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
});

test('equal-time additional current receipt blocks follow-up without comparing cross-endpoint IDs', async () => {
  const represented = reviewReceipt({
    id: 900,
    verdict: 'INCOMPLETE',
    url: 'https://github.com/ziyabeey1-ai/randevu/pull/183#issuecomment-900',
    timestamp: '2026-09-20T00:06:00Z',
  });
  const secondRequest = '1'.repeat(64);
  const sameSecondReview = reviewReceipt({
    id: 2,
    verdict: 'ACCEPTABLE',
    requestFingerprint: secondRequest,
    url: 'https://github.com/ziyabeey1-ai/randevu/pull/183#pullrequestreview-2',
    timestamp: represented.created_at,
    review: true,
  });
  const followUp = request();
  followUp.reviewMode = 'FOLLOW_UP';
  followUp.currentEvidence.review = {
    previousReviewedHeadSha: head,
    previousReviewedBaseSha: main,
    previousReceiptSourceRef: represented.html_url,
    previousReceiptObservedAt: Date.parse(represented.created_at),
    previousReceiptId: represented.id,
  };
  await assert.rejects(
    verifyDevelopmentReviewLiveState(followUp, {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
      fetchImpl: liveFetch({
        comments: [
          reviewLaunch(),
          represented,
          reviewLaunch({ id: 251, requestFingerprint: secondRequest }),
        ],
        reviews: [sameSecondReview],
      }),
    }),
    /R2_REVIEW_ALREADY_RECEIVED/,
  );
});

test('receipt without a matching triggered launch never stops spend', async () => {
  const result = await verifyDevelopmentReviewLiveState(request(), {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
    fetchImpl: liveFetch({ comments: [reviewReceipt()] }),
    git() { throw new Error('raw-head proof must not fetch merge ref'); },
  });
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
});

test('receipt with the wrong hidden challenge cannot stop spend', async () => {
  const result = await verifyDevelopmentReviewLiveState(request(), {
    repository: 'ziyabeey1-ai/randevu',
    token: 'test-token',
    tasksText: tasks(),
    reviewerAllowlist: { R1: ['claude[bot]'], R2: ['claude[bot]'] },
    fetchImpl: liveFetch({
      comments: [
        reviewLaunch(),
        reviewReceipt({ receiptChallenge: '1'.repeat(64) }),
      ],
    }),
    git() { throw new Error('raw-head proof must not fetch merge ref'); },
  });
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
});

test('merge-ref mismatch fails closed before model spend', async () => {
  await assert.rejects(
    verifyDevelopmentReviewLiveState(request({
      ci: { testedCheckoutSha: merge, explicitlyBoundToHead: true },
    }), {
      repository: 'ziyabeey1-ai/randevu',
      token: 'test-token',
      tasksText: tasks(),
      fetchImpl: liveFetch({ checkoutSha: merge }),
      git(args) {
        if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
        if (args[0] === 'rev-parse') return { status: 0, stdout: sha('d') + '\n', stderr: '' };
        throw new Error('unexpected git call');
      },
    }),
    /TESTED_CHECKOUT_LIVE_MERGE_REF_MISMATCH/,
  );
});
