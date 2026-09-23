import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[a-f0-9]{40}$/;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

function fail() {
  throw new Error('DEVELOPMENT_REVIEW_RESERVATION_IDENTITY_INVALID');
}

export function reviewReservationFingerprint(request = {}) {
  const { role, reviewMode, case: candidate = {}, currentEvidence = {} } = request;
  if (!['r1', 'r2'].includes(role)
      || !['FIRST_REVIEW', 'FOLLOW_UP'].includes(reviewMode)
      || typeof candidate.task !== 'string' || !candidate.task.trim()
      || !Number.isSafeInteger(candidate.pr) || candidate.pr <= 0
      || !SHA_RE.test(candidate.currentHead ?? '') || !SHA_RE.test(candidate.baseMain ?? '')) fail();
  let previous = null;
  if (reviewMode === 'FOLLOW_UP') {
    const review = currentEvidence.review ?? {};
    if (typeof review.previousReceiptSourceRef !== 'string' || !review.previousReceiptSourceRef
        || typeof review.previousReceiptObservedAt !== 'number'
        || !Number.isFinite(review.previousReceiptObservedAt) || review.previousReceiptObservedAt < 0
        || !SHA_RE.test(review.previousReviewedHeadSha ?? '')
        || !SHA_RE.test(review.previousReviewedBaseSha ?? '')) fail();
    previous = {
      source: review.previousReceiptSourceRef,
      observedAt: review.previousReceiptObservedAt,
      head: review.previousReviewedHeadSha,
      base: review.previousReviewedBaseSha,
    };
  }
  // This is the paid-work lane, not a payload hash. Nonces, CI reruns and other
  // reviewers' evidence cannot reopen it. A new candidate or own follow-up can.
  return createHash('sha256').update(JSON.stringify({
    schema: 'development-review-reservation.v1',
    task: candidate.task,
    pr: candidate.pr,
    role,
    head: candidate.currentHead,
    base: candidate.baseMain,
    reviewMode,
    previous,
  })).digest('hex');
}

export function findExistingReviewReservation(items, request, repository) {
  if (!Array.isArray(items) || typeof repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail();
  const key = reviewReservationFingerprint(request);
  if (!FINGERPRINT_RE.test(request.reservationFingerprint ?? '')
      || request.reservationFingerprint !== key) fail();
  const marker = `<!-- development-review-reservation:${request.role}:${key} -->`;
  const prefix = `https://github.com/${repository}/pull/${request.case.pr}#issuecomment-`;
  const existing = items.flat(Infinity).filter((item) => {
    if (item?.user?.login !== 'github-actions[bot]'
        || !Number.isSafeInteger(item.id) || item.id <= 0
        || item.html_url !== `${prefix}${item.id}`) return false;
    const body = String(item.body ?? '');
    if (body.includes(marker)) return true;
    // Accepted v1 launches may have no stable key. Preserve them conservatively rather
    // than issuing a duplicate merely because this workflow was upgraded.
    if (body.includes('<!-- development-review-reservation:')) return false;
    if (!body.includes(`<!-- development-review-launch:v1:${request.role}:`)) return false;
    const head = body.match(/^- exact head: ([a-f0-9]{40})\s*$/m)?.[1];
    const base = body.match(/^- base main: ([a-f0-9]{40})\s*$/m)?.[1];
    return head === request.case.currentHead && (!base || base === request.case.baseMain);
  });
  return existing.length ? Math.min(...existing.map((item) => item.id)) : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [requestFile, commentsFile] = process.argv.slice(2);
    if (!requestFile || !commentsFile) fail();
    const request = JSON.parse(readFileSync(requestFile, 'utf8'));
    const items = JSON.parse(readFileSync(commentsFile, 'utf8'));
    const existing = findExistingReviewReservation(items, request, process.env.GITHUB_REPOSITORY);
    process.stdout.write(existing === null ? '' : String(existing));
  } catch {
    console.error('DEVELOPMENT_REVIEW_RESERVATION_LOOKUP_BLOCKED');
    process.exitCode = 1;
  }
}
