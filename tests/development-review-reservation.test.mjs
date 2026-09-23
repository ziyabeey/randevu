import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import {
  reviewReservationFingerprint,
  findExistingReviewReservation,
} from '../scripts/development-review-reservation.mjs';

import { buildIndependentReviewRequest, reviewReceiptMarker } from '../scripts/development-review-request.mjs';
import { buildCaseFingerprint } from '../scripts/development-escalation-envelope.mjs';

const repository = 'ziyabeey/randevu';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
function request(role = 'r1') {
  const value = {
    role,
    reviewMode: 'FIRST_REVIEW',
    case: { task: 'DEV-ENGINE-04', pr: 211, currentHead: head, baseMain: base },
    currentEvidence: { ci: { run: '10', attempt: 1 }, review: {} },
    receiptChallenge: 'c'.repeat(64),
    requestFingerprint: 'd'.repeat(64),
  };
  value.reservationFingerprint = reviewReservationFingerprint(value);
  return value;
}
function launch(value, status, id = 7) {
  return {
    id,
    user: { login: 'github-actions[bot]' },
    html_url: `https://github.com/${repository}/pull/211#issuecomment-${id}`,
    body: [
      `<!-- development-review-launch:v1:${value.role}:${value.requestFingerprint} -->`,
      `<!-- development-review-reservation:${value.role}:${value.reservationFingerprint} -->`,
      `- status: ${status}`,
      `- exact head: ${value.case.currentHead}`,
      `- base main: ${value.case.baseMain}`,
    ].join('\n'),
  };
}

for (const role of ['r1', 'r2']) {
  for (const status of ['RESERVED', 'ROUTINE_TRIGGERED', 'LAUNCH_UNCERTAIN', 'LAUNCH_ABORTED_STALE']) {
    test(`${role} ${status} keeps its paid-work reservation across nonce and CI changes`, () => {
      const original = request(role);
      const repeated = structuredClone(original);
      repeated.receiptChallenge = 'e'.repeat(64);
      repeated.requestFingerprint = 'f'.repeat(64);
      repeated.currentEvidence.ci = { run: '99', attempt: 2 };
      repeated.materialEvidence = { otherReviewer: 'new receipt', observedAt: 'later' };
      assert.equal(reviewReservationFingerprint(repeated), original.reservationFingerprint);
      assert.equal(findExistingReviewReservation([[launch(original, status)]], repeated, repository), 7);
    });
  }
}

test('role task PR head and base identify separate paid-work lanes', () => {
  const original = request();
  for (const patch of [
    { role: 'r2' },
    { case: { ...original.case, task: 'DEV-ENGINE-05' } },
    { case: { ...original.case, pr: 212 } },
    { case: { ...original.case, currentHead: 'e'.repeat(40) } },
    { case: { ...original.case, baseMain: 'f'.repeat(40) } },
  ]) assert.notEqual(reviewReservationFingerprint({ ...original, ...patch }), original.reservationFingerprint);
});

test('only an explicit own receipt follow-up opens a new same-candidate lane', () => {
  const first = request();
  const followUp = structuredClone(first);
  followUp.reviewMode = 'FOLLOW_UP';
  followUp.currentEvidence.review = {
    previousReceiptSourceRef: `https://github.com/${repository}/pull/211#issuecomment-80`,
    previousReceiptObservedAt: 1000,
    previousReviewedHeadSha: head,
    previousReviewedBaseSha: base,
  };
  followUp.reservationFingerprint = reviewReservationFingerprint(followUp);
  assert.notEqual(followUp.reservationFingerprint, first.reservationFingerprint);
  assert.equal(findExistingReviewReservation([launch(first, 'ROUTINE_TRIGGERED')], followUp, repository), null);
  assert.equal(findExistingReviewReservation([launch(followUp, 'RESERVED')], followUp, repository), 7);
  const next = structuredClone(followUp);
  next.currentEvidence.review.previousReceiptObservedAt += 1;
  assert.notEqual(reviewReservationFingerprint(next), followUp.reservationFingerprint);
});

test('pre-key v1 same-candidate launches are held rather than silently relaunched', () => {
  const value = request();
  const legacy = launch(value, 'ROUTINE_TRIGGERED');
  legacy.body = legacy.body.split('\n').filter((line) => !line.includes('development-review-reservation:')).join('\n');
  assert.equal(findExistingReviewReservation([legacy], value, repository), 7);
  legacy.body = legacy.body.replace(`- base main: ${base}`, '');
  assert.equal(findExistingReviewReservation([legacy], value, repository), 7);
  legacy.body += `\n- base main: ${'f'.repeat(40)}`;
  assert.equal(findExistingReviewReservation([legacy], value, repository), null);
});

test('untrusted or wrong-repository comments cannot reserve a lane', () => {
  const value = request();
  const existing = launch(value, 'RESERVED');
  for (const changed of [
    { ...existing, user: { login: 'stranger' } },
    { ...existing, html_url: existing.html_url.replace(repository, 'outside/repo') },
    { ...existing, html_url: existing.html_url.replace('/pull/211#', '/issues/65#') },
    { ...existing, id: 8 },
  ]) assert.equal(findExistingReviewReservation([changed], value, repository), null);
  assert.equal(findExistingReviewReservation([], value, repository), null);
});

test('malformed evidence and mismatching reservation identities fail closed', () => {
  const value = request();
  assert.throws(() => findExistingReviewReservation({}, value, repository), /IDENTITY_INVALID/);
  assert.throws(() => findExistingReviewReservation([], { ...value, reservationFingerprint: 'e'.repeat(64) }, repository), /IDENTITY_INVALID/);
  assert.throws(() => reviewReservationFingerprint({ ...value, reviewMode: 'FOLLOW_UP' }), /IDENTITY_INVALID/);
});

test('CLI reads paginated collections and never outputs the challenge', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-reservation-'));
  try {
    const value = request();
    const requestFile = path.join(dir, 'request.json');
    const commentsFile = path.join(dir, 'comments.json');
    writeFileSync(requestFile, JSON.stringify(value));
    writeFileSync(commentsFile, JSON.stringify([[launch(value, 'LAUNCH_UNCERTAIN')]]));
    const result = spawnSync(process.execPath, [
      new URL('../scripts/development-review-reservation.mjs', import.meta.url).pathname,
      requestFile, commentsFile,
    ], { encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: repository }, timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '7');
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(value.receiptChallenge));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both role workflows use stable lookup and retain markers on every lifecycle state', () => {
  const workflow = readFileSync(new URL('../.github/workflows/development-review-router.yml', import.meta.url), 'utf8');
  for (const role of ['r1', 'r2']) {
    const section = workflow.split(`  ${role}:\n`)[1]?.split('  r2:\n')[0] ?? '';
    assert.match(section, /jq -er '\.reservationFingerprint'/);
    assert.match(section, /node scripts\/development-review-reservation\.mjs/);
    assert.match(section, /gh api --paginate --slurp/);
    assert.equal((section.match(/\$\{reservation_marker\}/g) ?? []).length, 4);
    assert.match(section, /RESERVATION_FINGERPRINT: \$\{\{ steps\.prepare\.outputs\.reservation_fingerprint \}\}/);
    assert.match(section, /cancel-in-progress: false/);
  }
});


function dispatcher(roles = ['r1', 'r2']) {
  return {
    facts: {
      task: { id: 'DEV-ENGINE-04' },
      candidate: { taskId: 'DEV-ENGINE-04', prNumber: 211, branch: 'smoke', headSha: head, baseMainSha: base },
      observation: { liveMainSha: base },
      ci: { status: 'pass', exactHeadSha: head, testedCheckoutSha: head, baseMainSha: base, run: '10', job: '20', attempt: 1 },
      reviews: Object.fromEntries(roles.map((role) => [role, { requirement: 'required', receipt: 'missing', verdict: 'pending' }])),
    },
    recommendation: { suggestedAction: 'request_required_reviews', eligibleRoles: roles },
    obligations: roles.map((role) => ({ code: `${role.toUpperCase()}_REVIEW_REQUIRED`, role })),
  };
}

function preparedRequest(input, evidence, role, receiptChallenge) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-prepare-'));
  try {
    const dispatcherFile = path.join(dir, 'dispatcher.json');
    const evidenceFile = path.join(dir, 'evidence.json');
    const requestFile = path.join(dir, 'request.json');
    writeFileSync(dispatcherFile, JSON.stringify(input));
    writeFileSync(evidenceFile, JSON.stringify(evidence));
    const completed = spawnSync(process.execPath, [
      new URL('../scripts/prepare-development-review-request.mjs', import.meta.url).pathname,
      dispatcherFile, evidenceFile, role, buildCaseFingerprint(input, evidence), requestFile, receiptChallenge,
    ], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(completed.status, 0, completed.stderr);
    const request = JSON.parse(readFileSync(requestFile, 'utf8'));
    // The adapter must actually produce the same bounded provider payload.
    const expected = buildIndependentReviewRequest(input, evidence, role, { receiptChallenge });
    assert.equal(request.requestFingerprint, expected.requestFingerprint);
    assert.equal(request.receiptChallenge, receiptChallenge);
    assert.equal(JSON.parse(completed.stdout).text.includes(request.requestFingerprint), true);
    return request;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('real transport adapter keeps exact receipt binding separate from stable reservation', () => {
  for (const role of ['r1', 'r2']) {
    const input = dispatcher([role]);
    const first = preparedRequest(input, {}, role, 'c'.repeat(64));
    input.facts.ci.attempt = 2;
    const repeated = preparedRequest(input, { observedAt: '2026-09-20T12:00:00Z' }, role, 'd'.repeat(64));
    assert.match(first.reservationFingerprint, /^[a-f0-9]{64}$/);
    assert.notEqual(first.requestFingerprint, repeated.requestFingerprint);
    assert.equal(first.reservationFingerprint, repeated.reservationFingerprint);
    assert.equal(findExistingReviewReservation([launch(first, 'RESERVED')], repeated, repository), 7);
    assert.notEqual(reviewReceiptMarker(first, 'ACCEPTABLE'), reviewReceiptMarker(repeated, 'ACCEPTABLE'));
  }
});

test('sibling review context cannot purchase the same pending role twice', () => {
  const first = preparedRequest(dispatcher(), {}, 'r2', 'c'.repeat(64));
  const evidence = {
    sourceRefs: [`https://github.com/${repository}/pull/211#issuecomment-900`],
    materialFacts: { priorReviewReceipts: { r1: 'new-r1-receipt' } },
  };
  const repeated = preparedRequest(dispatcher(['r2']), evidence, 'r2', 'd'.repeat(64));
  assert.match(first.reservationFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(first.requestFingerprint, repeated.requestFingerprint);
  assert.equal(first.reservationFingerprint, repeated.reservationFingerprint);
  assert.equal(findExistingReviewReservation([launch(first, 'ROUTINE_TRIGGERED')], repeated, repository), 7);
});

// Version migration remains explicit. This v1 repair must not make old v0
// launches valid result authority or silently alter the accepted v1 rollout.
test('unversioned v0 launch does not impersonate a v1 paid-work reservation', () => {
  const value = request();
  const old = launch(value, 'ROUTINE_TRIGGERED');
  old.body = old.body.split('\n').filter((line) => !line.includes('development-review-reservation:')).join('\n');
  old.body = old.body.replace('development-review-launch:v1:', 'development-review-launch:');
  assert.equal(findExistingReviewReservation([old], value, repository), null);
});
