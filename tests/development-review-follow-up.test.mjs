import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyDevelopmentReviewLiveState } from '../scripts/verify-development-review-live-state.mjs';

const repository = 'ziyabeey/randevu';
const head = 'a'.repeat(40), base = 'b'.repeat(40), oldHead = 'c'.repeat(40);
const publisher = 'claude[bot]';
const allowlist = { R1: [publisher], R2: [publisher] };
const time = '2026-09-20T10:00:00Z';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const tasksText = `| DEV-ENGINE-04 | Reviews | TEMEL | In review | Coordinator | https://github.com/${repository}/pull/216 |`;

function evidence(role = 'r1', options = {}) {
  const id = options.id ?? 300;
  const reviewedHead = options.head ?? head, reviewedBase = options.base ?? base;
  const sourceRepo = options.repository ?? repository, pr = options.pr ?? 216;
  const receiptChallenge = hash(`fixture-challenge:${role}:${id}`);
  const requestFingerprint = hash(`fixture-request:${role}:${id}:${reviewedHead}:${reviewedBase}`);
  const dispatcherCaseFingerprint = hash('fixture-case');
  const source = `https://github.com/${sourceRepo}/pull/${pr}`;
  const marker = {
    schemaVersion: 'development-review-receipt.v1', role: role.toUpperCase(), prNumber: pr,
    headSha: reviewedHead, baseSha: reviewedBase, dispatcherCaseFingerprint,
    requestFingerprint, receiptChallenge, verdict: options.verdict ?? 'INCOMPLETE',
  };
  const receipt = {
    id,
    html_url: `${source}#${options.nativeReview ? 'pullrequestreview' : 'issuecomment'}-${id}`,
    user: { login: publisher },
    ...(options.nativeReview
      ? { submitted_at: options.time ?? time, commit_id: reviewedHead }
      : { created_at: options.time ?? time }),
    body: `<!-- development-review-receipt ${JSON.stringify(marker)} -->`,
  };
  const launch = {
    id: id + 1000, html_url: `${source}#issuecomment-${id + 1000}`,
    user: { login: 'github-actions[bot]' }, created_at: '2026-09-20T09:59:00Z',
    body: [
      `<!-- development-review-launch:v1:${role}:${requestFingerprint} -->`,
      '- status: ROUTINE_TRIGGERED', `- exact head: ${reviewedHead}`,
      `- base main: ${reviewedBase}`, `- dispatcher case: ${dispatcherCaseFingerprint}`,
      `- role request: ${requestFingerprint}`, `- receipt challenge hash: ${hash(receiptChallenge)}`,
    ].join('\n'),
  };
  const snapshot = {
    requirement: 'required', receipt: 'accessible', verdict: marker.verdict.toLowerCase(),
    previousReviewedHeadSha: reviewedHead, previousReviewedBaseSha: reviewedBase,
    previousReceiptSourceRef: receipt.html_url,
    previousReceiptObservedAt: Date.parse(options.time ?? time), previousReceiptId: id,
  };
  return { receipt, launch, snapshot, marker };
}

function request(role, snapshot) {
  return {
    schemaVersion: 'development-independent-review-request.v0', role,
    reviewMode: snapshot ? 'FOLLOW_UP' : 'FIRST_REVIEW',
    case: { task: 'DEV-ENGINE-04', pr: 216, currentHead: head, baseMain: base, currentMain: base },
    currentEvidence: {
      ci: { status: 'pass', exactHeadSha: head, testedCheckoutSha: head,
        explicitlyBoundToHead: false, baseMainSha: base, run: '100', job: '200', attempt: 1 },
      ...(snapshot ? { review: { ...snapshot } } : {}),
    },
  };
}

function verifierOptions(pairs = [], options = {}) {
  const comments = pairs.flatMap((pair) => [pair.launch, ...(pair.receipt.commit_id ? [] : [pair.receipt])]);
  const reviews = pairs.filter((pair) => pair.receipt.commit_id).map((pair) => pair.receipt);
  return {
    repository, token: 'fixture-only', tasksText, reviewerAllowlist: options.allowlist ?? allowlist,
    git() { throw new Error('Unexpected git execution for exact raw-head fixture'); },
    async fetchImpl(url, init = {}) {
      assert.equal(init.method ?? 'GET', 'GET', 'live verification must be read-only');
      const parsed = new URL(url), route = parsed.pathname;
      let body;
      if (route.endsWith('/pulls/216')) body = {
        number: 216, state: 'open', user: { login: 'implementer' },
        head: { sha: head }, base: { sha: base },
      };
      else if (route.endsWith('/branches/main')) body = { commit: { sha: base } };
      else if (route.endsWith('/actions/runs/100')) body = {
        id: 100, head_sha: head, status: 'completed', conclusion: 'success', run_attempt: 1,
        event: 'pull_request', pull_requests: [{ number: 216 }], path: '.github/workflows/ci.yml',
      };
      else if (route.endsWith('/actions/runs/100/attempts/1/jobs')) body = { jobs: [{
        id: 200, name: 'CI gate', status: 'completed', conclusion: 'success', run_attempt: 1,
      }] };
      else if (route.endsWith('/actions/jobs/200/logs')) body = `[command]/usr/bin/git log -1 --format=%H\n${head}\n`;
      else if (route.endsWith('/issues/216/comments')) body = options.comments ?? comments;
      else if (route.endsWith('/pulls/216/reviews')) body = reviews;
      else if (route.endsWith('/issues/65/comments')) body = options.coordinationComments ?? [];
      else throw new Error(`Unexpected fixture API: ${url}`);
      if (options.transform) body = options.transform(route, structuredClone(body));
      return { ok: true, status: 200, json: async () => body, text: async () => String(body) };
    },
  };
}

const rejectedSnapshot = /FOLLOW_UP_RECEIPT_(?:SNAPSHOT_MISSING|NOT_AUTHENTICATED)/;
for (const role of ['r1', 'r2']) {
  test(`${role}: fabricated historical FOLLOW_UP cannot authorize another paid lane`, async () => {
    const invented = evidence(role, { head: oldHead });
    await assert.rejects(
      verifyDevelopmentReviewLiveState(request(role, invented.snapshot), verifierOptions()),
      rejectedSnapshot,
    );
  });

  test(`${role}: exact authenticated current INCOMPLETE follow-up remains allowed`, async () => {
    const prior = evidence(role);
    const result = await verifyDevelopmentReviewLiveState(request(role, prior.snapshot), verifierOptions([prior]));
    assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
  });

  test(`${role}: latest authenticated historical receipt allows a real new-candidate follow-up`, async () => {
    const prior = evidence(role, { head: oldHead, verdict: 'ACCEPTABLE' });
    const result = await verifyDevelopmentReviewLiveState(request(role, prior.snapshot), verifierOptions([prior]));
    assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
  });

  for (const verdict of ['ACCEPTABLE', 'BLOCKER']) {
    test(`${role}: current ${verdict} cannot be relabelled INCOMPLETE to open paid work`, async () => {
      const prior = evidence(role, { verdict });
      await assert.rejects(verifyDevelopmentReviewLiveState(
        request(role, { ...prior.snapshot, verdict: 'incomplete' }), verifierOptions([prior]),
      ), /REVIEW_ALREADY_RECEIVED/);
    });
  }
}

for (const [name, change] of [
  ['native ID', { previousReceiptId: 301 }],
  ['timestamp', { previousReceiptObservedAt: Date.parse(time) + 1 }],
  ['reviewed head', { previousReviewedHeadSha: oldHead }],
  ['reviewed base', { previousReviewedBaseSha: oldHead }],
  ['source URL', { previousReceiptSourceRef: `https://github.com/${repository}/pull/216#issuecomment-999` }],
  ['null timestamp', { previousReceiptObservedAt: null }],
  ['coerced ID', { previousReceiptId: '300' }],
]) {
  test(`follow-up rejects changed ${name} instead of trusting caller shape`, async () => {
    const prior = evidence();
    await assert.rejects(verifyDevelopmentReviewLiveState(
      request('r1', { ...prior.snapshot, ...change }), verifierOptions([prior]),
    ), rejectedSnapshot);
  });
}

for (const [name, options, prepare] of [
  ['wrong role with shared publisher', {}, () => evidence('r2')],
  ['wrong repository', {}, () => evidence('r1', { repository: 'another/repository' })],
  ['wrong PR', {}, () => evidence('r1', { pr: 217 })],
  ['missing launch', { comments: [] }, () => evidence()],
  ['unconfigured publisher', { allowlist: {} }, () => evidence()],
  ['wrong challenge', {}, () => {
    const pair = evidence();
    pair.receipt.body = pair.receipt.body.replace(pair.marker.receiptChallenge, '0'.repeat(64));
    return pair;
  }],
]) {
  test(`follow-up fails closed for ${name}`, async () => {
    const pair = prepare();
    await assert.rejects(verifyDevelopmentReviewLiveState(
      request('r1', pair.snapshot), verifierOptions([pair], options),
    ), rejectedSnapshot);
  });
}

test('coordination-only source is not a final prior receipt', async () => {
  const pair = evidence();
  pair.receipt.html_url = `https://github.com/${repository}/issues/65#issuecomment-300`;
  pair.snapshot.previousReceiptSourceRef = pair.receipt.html_url;
  await assert.rejects(verifyDevelopmentReviewLiveState(
    request('r1', pair.snapshot), verifierOptions([], {
      comments: [pair.launch], coordinationComments: [pair.receipt],
    }),
  ), rejectedSnapshot);
});

test('native PR review can be the authenticated represented predecessor', async () => {
  const pair = evidence('r1', { nativeReview: true });
  const result = await verifyDevelopmentReviewLiveState(request('r1', pair.snapshot), verifierOptions([pair]));
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
});

for (const [name, incomingOptions] of [
  ['newer current', { id: 301, time: '2026-09-20T10:01:00Z' }],
  ['equal-time smaller native review ID', { id: 2, nativeReview: true }],
]) {
  test(`${name} still stops a represented follow-up`, async () => {
    const prior = evidence(), incoming = evidence('r1', { ...incomingOptions, verdict: 'ACCEPTABLE' });
    await assert.rejects(verifyDevelopmentReviewLiveState(
      request('r1', prior.snapshot), verifierOptions([prior, incoming]),
    ), /REVIEW_ALREADY_RECEIVED/);
  });
}

test('a superseded historical predecessor cannot manufacture a fresh reservation key', async () => {
  const prior = evidence('r1', { head: oldHead });
  const later = evidence('r1', { id: 301, head: oldHead, time: '2026-09-20T10:01:00Z' });
  await assert.rejects(verifyDevelopmentReviewLiveState(
    request('r1', prior.snapshot), verifierOptions([prior, later]),
  ), /REVIEW_ALREADY_RECEIVED/);
});

test('historical receipt cannot replace exact-current evidence even when posted later', async () => {
  const prior = evidence('r1', { head: oldHead, time: '2026-09-20T10:02:00Z' });
  const current = evidence('r1', { id: 301, verdict: 'ACCEPTABLE' });
  await assert.rejects(verifyDevelopmentReviewLiveState(
    request('r1', prior.snapshot), verifierOptions([prior, current]),
  ), /REVIEW_ALREADY_RECEIVED/);
});

test('later stale or sibling evidence does not suppress the exact current INCOMPLETE follow-up', async () => {
  const prior = evidence();
  const stale = evidence('r1', { id: 301, head: oldHead, time: '2026-09-20T10:02:00Z' });
  const sibling = evidence('r2', { id: 302, verdict: 'ACCEPTABLE' });
  const result = await verifyDevelopmentReviewLiveState(
    request('r1', prior.snapshot), verifierOptions([prior, stale, sibling]),
  );
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
});

test('FIRST_REVIEW remains allowed without receipts and blocked by a current receipt', async () => {
  const result = await verifyDevelopmentReviewLiveState(request('r1'), verifierOptions());
  assert.equal(result.status, 'LIVE_REVIEW_STATE_VERIFIED');
  await assert.rejects(verifyDevelopmentReviewLiveState(request('r1'), verifierOptions([evidence()])), /REVIEW_ALREADY_RECEIVED/);
});

test('failed CI still blocks before any follow-up authorization', async () => {
  const prior = evidence();
  await assert.rejects(verifyDevelopmentReviewLiveState(request('r1', prior.snapshot), verifierOptions([prior], {
    transform(route, body) {
      if (route.endsWith('/actions/runs/100')) body.conclusion = 'failure';
      return body;
    },
  })), /LIVE_CI_RUN_MISMATCH/);
});
