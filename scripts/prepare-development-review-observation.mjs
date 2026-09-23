import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveDispatcherResult } from './development-dispatcher.mjs';
import { authenticatedReceipts, parseReviewerAllowlist } from './development-audit-gate.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const modulePath = fileURLToPath(import.meta.url);

function fail(code) {
  throw new Error(`DEVELOPMENT_REVIEW_OBSERVATION_BLOCKED: ${code}`);
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (Array.isArray(item) ? asArray(item) : [item]));
}

function runsFrom(value) {
  if (Array.isArray(value)) return asArray(value);
  if (Array.isArray(value?.workflow_runs)) return value.workflow_runs;
  return value && typeof value === 'object' ? [value] : [];
}

function jobsFrom(value) {
  if (Array.isArray(value?.jobs)) return value.jobs;
  return asArray(value).flatMap((page) => Array.isArray(page?.jobs) ? page.jobs : []);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function timestamp(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

function latest(values) {
  const observed = (value) => Number.isFinite(Number(value?.observedAt))
    ? Number(value.observedAt)
    : timestamp(value?.updated_at ?? value?.submitted_at ?? value?.created_at);
  return [...values].sort((left, right) => {
    const date = observed(right) - observed(left);
    if (date !== 0) return date;
    return Number(right.id ?? 0) - Number(left.id ?? 0);
  })[0] ?? null;
}

function pullNumbers(run) {
  return Array.isArray(run?.pull_requests)
    ? run.pull_requests.map((item) => Number(item?.number)).filter(Number.isInteger)
    : [];
}

function pullBaseSha(run, prNumber) {
  const item = Array.isArray(run?.pull_requests)
    ? run.pull_requests.find((candidate) => Number(candidate?.number) === prNumber)
    : null;
  return item?.base?.sha ?? null;
}

export function selectCurrentSuccessfulCiRun(rawRuns, pr) {
  const prNumber = positiveInteger(pr?.number);
  const head = pr?.head?.sha;
  if (!prNumber || !SHA_RE.test(head ?? '')) fail('PR_IDENTITY_INVALID');

  return latest(runsFrom(rawRuns).filter((run) => (
    positiveInteger(run?.id)
    && run?.event === 'pull_request'
    && run?.status === 'completed'
    && run?.conclusion === 'success'
    && run?.path === '.github/workflows/ci.yml'
    && run?.head_sha === head
    && pullNumbers(run).includes(prNumber)
    && (!pullBaseSha(run, prNumber) || pullBaseSha(run, prNumber) === pr?.base?.sha)
    && positiveInteger(run?.run_attempt)
  )));
}

function taskIdFromCell(cell) {
  const trimmed = String(cell ?? '').trim();
  return trimmed.match(/^\[([^\]]+)\]\(/)?.[1] ?? trimmed;
}

export function findTaskBinding(tasksText, repository, prNumber) {
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prPattern = new RegExp(
    `https://github\\.com/${escapedRepository}/pull/${prNumber}(?=[^0-9]|$)`,
  );
  const rows = String(tasksText ?? '').split(/\r?\n/)
    .filter((line) => line.startsWith('|') && prPattern.test(line))
    .map((line) => ({
      line,
      cells: line.split('|').slice(1, -1).map((cell) => cell.trim()),
    }))
    .filter(({ cells }) => cells.length >= 5 && !/^[-: ]+$/.test(cells[0] ?? ''));

  if (rows.length !== 1) fail(rows.length === 0 ? 'TASK_PR_BINDING_MISSING' : 'TASK_PR_BINDING_AMBIGUOUS');
  const [row] = rows;
  const id = taskIdFromCell(row.cells[0]);
  if (!id) fail('TASK_ID_MISSING');
  return { ...row, id };
}

function taskState(row) {
  const status = String(row.cells[3] ?? '').toLocaleLowerCase('tr-TR');
  const owner = row.cells[4] ?? '';
  const blocked = /engelli|blocked/i.test(status);
  const review = /incele|review/i.test(status);
  const active = /çalış|active|main'de \/ kabul açık/i.test(status);
  return {
    liveStatus: review ? 'review' : active || blocked ? 'active' : 'unknown',
    dependencyState: blocked ? 'blocked' : 'ready',
    assignmentState: owner && !/^(?:—|-|none)$/i.test(owner) ? 'assigned' : 'unknown',
    writerStatus: 'clear',
  };
}

function negativeRequirement(text, role) {
  return [
    `${role} gerekmez`,
    `${role} gerekmiyor`,
    `${role} beklenmiyor`,
    `${role} not required`,
    `no ${role}`,
  ].some((phrase) => text.includes(phrase));
}

export function reviewRequirementsFromTaskRow(rowText) {
  const text = String(rowText ?? '').toLocaleLowerCase('tr-TR');
  const mentions = {
    r1: /(?:^|[^a-z0-9])r1(?:[^a-z0-9]|$)/i.test(text),
    r2: /(?:^|[^a-z0-9])r2(?:[^a-z0-9]|$)/i.test(text),
  };
  const hasReviewBudget = mentions.r1 || mentions.r2;
  return Object.fromEntries(['r1', 'r2'].map((role) => {
    if (negativeRequirement(text, role)) return [role, 'not_required'];
    if (mentions[role]) return [role, 'required'];
    return [role, hasReviewBudget ? 'not_required' : 'unknown'];
  }));
}

function extractReviewedSha(body, fallback = null) {
  const text = String(body ?? '');
  const labelled = text.match(
    /(?:reviewed\s+sha|reviewed\s+exact\s+head|exact(?:-sha|\s+sha|\s+head)|current\s+head|head)\s*:?\s*[`*]*([a-f0-9]{40})/i,
  )?.[1]?.toLowerCase();
  if (SHA_RE.test(labelled ?? '')) return labelled;
  return SHA_RE.test(fallback ?? '') ? fallback.toLowerCase() : null;
}

function verdictFromBody(body) {
  const text = String(body ?? '');
  const match = text.match(/verdict\s*:\s*[*_`]*(acceptable|blocker|incomplete)/i)?.[1];
  return match ? match.toLowerCase() : null;
}

function receiptUrl(repository, prNumber, item, kind) {
  if (typeof item?.html_url === 'string') return item.html_url;
  if (!positiveInteger(item?.id)) return null;
  if (kind === 'review') return `https://github.com/${repository}/pull/${prNumber}#pullrequestreview-${item.id}`;
  return `https://github.com/${repository}/pull/${prNumber}#issuecomment-${item.id}`;
}

function receiptCandidates({ repository, pr, prReviews, prComments }) {
  // Independent review authority is PR-local. Issue #65 remains temporary
  // coordination and cannot supply acceptance receipts.
  const comments = asArray(prComments).map((item) => ({ ...item, kind: 'comment' }));
  const reviews = asArray(prReviews).map((item) => ({ ...item, kind: 'review' }));
  return [...comments, ...reviews].map((item) => ({
    ...item,
    sourceRef: receiptUrl(repository, pr.number, item, item.kind),
    author: item?.user?.login ?? null,
    trustedAuthor: ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(item?.author_association),
  }));
}

function unambiguousLatestReceipt(values) {
  if (!values.length) return { receipt: null, ambiguous: false };
  const maxObservedAt = Math.max(...values.map((item) => Number(item.observedAt ?? 0)));
  const latestGroup = values.filter((item) => Number(item.observedAt ?? 0) === maxObservedAt);
  const signatures = new Set(latestGroup.map((item) => JSON.stringify([
    item.role,
    item.headSha,
    item.baseSha,
    item.dispatcherCaseFingerprint,
    item.requestFingerprint,
    item.verdict,
  ])));
  if (signatures.size > 1) return { receipt: null, ambiguous: true };
  return { receipt: latest(latestGroup), ambiguous: false };
}

function independentReceipt(candidates, authenticated, role, requirement, currentHead, currentBase) {
  if (requirement === 'not_required') {
    return {
      requirement,
      verdict: 'not_required',
      receipt: 'missing',
      reviewedHeadSha: null,
      reviewedBaseSha: null,
      sourceRef: null,
      reviewedAt: null,
      receiptId: null,
    };
  }
  if (requirement === 'unknown') {
    return {
      requirement,
      verdict: 'unknown',
      receipt: 'unknown',
      reviewedHeadSha: null,
      reviewedBaseSha: null,
      sourceRef: null,
      reviewedAt: null,
      receiptId: null,
    };
  }

  const roleName = role.toUpperCase();
  const receipts = authenticated
    .filter((entry) => entry.role === roleName)
    .map((entry) => {
      const source = candidates.find((item) => item.id === entry.id && item.sourceRef === entry.url);
      return source ? {
        ...entry,
        verdict: String(entry.verdict ?? '').toLowerCase(),
        sourceRef: entry.url,
      } : null;
    })
    .filter((item) => item && item.verdict
      && !/launch receipt only|status:\s*(?:reserved|routine_triggered|launch_)/i.test(String(
        candidates.find((candidate) => candidate.id === item.id && candidate.sourceRef === item.sourceRef)?.body ?? '',
      )));

  const currentSelection = unambiguousLatestReceipt(receipts.filter((item) =>
    item.headSha === currentHead && item.baseSha === currentBase));
  if (currentSelection.ambiguous) {
    return {
      requirement,
      verdict: 'unknown',
      receipt: 'unknown',
      reviewedHeadSha: null,
      reviewedBaseSha: null,
      sourceRef: null,
      reviewedAt: null,
      receiptId: null,
    };
  }

  const historicalSelection = currentSelection.receipt
    ? { receipt: currentSelection.receipt, ambiguous: false }
    : unambiguousLatestReceipt(receipts);
  if (historicalSelection.ambiguous) {
    return {
      requirement,
      verdict: 'unknown',
      receipt: 'unknown',
      reviewedHeadSha: null,
      reviewedBaseSha: null,
      sourceRef: null,
      reviewedAt: null,
      receiptId: null,
    };
  }

  const prior = historicalSelection.receipt;
  if (!prior) {
    return {
      requirement,
      verdict: 'pending',
      receipt: 'missing',
      reviewedHeadSha: null,
      reviewedBaseSha: null,
      sourceRef: null,
      reviewedAt: null,
      receiptId: null,
    };
  }
  return {
    requirement,
    verdict: prior.verdict,
    receipt: 'accessible',
    reviewedHeadSha: prior.headSha,
    reviewedBaseSha: prior.baseSha,
    sourceRef: prior.sourceRef,
    reviewedAt: prior.observedAt,
    receiptId: prior.id,
  };
}

function unresolvedReviewThreads(rawThreads) {
  const connection = rawThreads?.data?.repository?.pullRequest?.reviewThreads;
  if (connection?.pageInfo?.hasNextPage === true) fail('REVIEW_THREADS_TRUNCATED');
  const nodes = connection?.nodes;
  if (!Array.isArray(nodes)) fail('REVIEW_THREADS_UNAVAILABLE');
  return nodes.filter((thread) => thread?.isResolved !== true && thread?.isOutdated !== true);
}

function r0Receipt(candidates, currentHead, rawThreads) {
  const openThreads = unresolvedReviewThreads(rawThreads);
  const receipts = candidates.filter((item) => {
    const author = String(item.author ?? '');
    const body = String(item.body ?? '');
    const reviewedHeadSha = extractReviewedSha(body, item.commit_id);
    return reviewedHeadSha === currentHead
      && (/copilot-pull-request-reviewer/i.test(author)
        || (item.trustedAuthor
          && /(?:^|[^a-z0-9])r0(?:[^a-z0-9]|$)/i.test(body)
          && /verdict\s*:/i.test(body)));
  });
  const receipt = latest(receipts);
  if (!receipt) {
    return {
      requirement: 'required',
      receipt: 'missing',
      freeze: 'missing',
      frozenBlockers: [],
      blockerClosures: [],
      reviewedHeadSha: null,
      sourceRef: null,
    };
  }

  const body = String(receipt.body ?? '');
  const structuredCleanVerdict = /verdict\s*:\s*(?:no\s+findings|acceptable)/i.test(body);
  const nativeNoFindings = /\*\*findings:\**\s*none/i.test(body);
  const claimsUnresolved = /unresolved[^\n]*(?:issue|finding|remain)|(?:issue|finding)[^\n]*remain[^\n]*unresolved/i.test(body);
  const clean = structuredCleanVerdict || (nativeNoFindings && !claimsUnresolved);
  const blockers = [
    ...(clean ? [] : [`R0-REVIEW-${receipt.id}`]),
    ...openThreads.map((thread, index) => `R0-THREAD-${thread?.id ?? index + 1}`),
  ];
  return {
    requirement: 'required',
    receipt: 'accessible',
    freeze: blockers.length === 0 ? 'none' : 'blockers',
    frozenBlockers: blockers,
    blockerClosures: blockers.map((id) => ({ id, status: 'open', sourceRef: receipt.sourceRef })),
    reviewedHeadSha: currentHead,
    sourceRef: receipt.sourceRef,
  };
}

function validateRepository(repository) {
  if (typeof repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail('REPOSITORY_INVALID');
}

export function buildDevelopmentReviewObservation({
  repository,
  tasksText,
  pr,
  main,
  runs,
  jobs,
  prReviews = [],
  prComments = [],
  coordinationComments = [],
  reviewThreads,
  reviewerAllowlist = parseReviewerAllowlist(process.env.DEVELOPMENT_REVIEWER_ALLOWLIST),
  observedAt = new Date().toISOString(),
} = {}) {
  validateRepository(repository);
  const prNumber = positiveInteger(pr?.number);
  const head = pr?.head?.sha;
  const base = pr?.base?.sha;
  const liveMain = main?.commit?.sha;
  if (!prNumber || pr?.state !== 'open' || pr?.draft === true) fail('PR_NOT_ACTIVE');
  if (pr?.head?.repo?.full_name !== repository || pr?.base?.ref !== 'main') fail('PR_TRUST_BOUNDARY_INVALID');
  if (![head, base, liveMain].every((value) => SHA_RE.test(value ?? ''))) {
    fail('PR_OR_MAIN_SHA_INVALID');
  }

  const task = findTaskBinding(tasksText, repository, prNumber);
  const taskStateFacts = taskState(task);
  const requirements = reviewRequirementsFromTaskRow(task.line);
  const run = selectCurrentSuccessfulCiRun(runs, pr);
  if (!run) fail('CURRENT_SUCCESSFUL_CI_MISSING');
  const attempt = positiveInteger(run.run_attempt);
  const ciJob = jobsFrom(jobs).find((item) => (
    item?.name === 'CI gate'
    && item?.status === 'completed'
    && item?.conclusion === 'success'
    && (!item?.run_attempt || Number(item.run_attempt) === attempt)
  ));
  if (!positiveInteger(ciJob?.id)) fail('CURRENT_SUCCESSFUL_CI_JOB_MISSING');

  const candidates = receiptCandidates({
    repository,
    pr,
    prReviews,
    prComments,
  });
  const authenticated = authenticatedReceipts(candidates.map((item) => ({
    ...item,
    html_url: item.sourceRef,
    user: { login: item.author },
  })), pr, reviewerAllowlist);
  const reviews = {
    r1: independentReceipt(candidates, authenticated, 'r1', requirements.r1, head, base),
    r2: independentReceipt(candidates, authenticated, 'r2', requirements.r2, head, base),
  };
  const r0 = r0Receipt(candidates, head, reviewThreads);
  const historicalIndependentReceipt = ['r1', 'r2']
    .some((role) => reviews[role].reviewedHeadSha && reviews[role].reviewedHeadSha !== head);

  const sourceRefs = [
    `TASKS.md:${task.id}`,
    `https://github.com/${repository}/pull/${prNumber}`,
    run.html_url ?? `https://github.com/${repository}/actions/runs/${run.id}`,
    r0.sourceRef,
    reviews.r1.sourceRef,
    reviews.r2.sourceRef,
  ].filter(Boolean);

  const observation = {
    task: { id: task.id, ...taskStateFacts },
    candidate: {
      taskId: task.id,
      prNumber,
      branch: pr.head.ref ?? null,
      presence: 'active',
      headSha: head,
      baseMainSha: base,
      mergeSha: null,
    },
    observation: {
      observedHeadSha: run.head_sha,
      liveHeadSha: head,
      observedMainSha: base,
      liveMainSha: liveMain,
    },
    ci: {
      status: 'pass',
      exactHeadSha: run.head_sha,
      testedCheckoutSha: head,
      baseMainSha: base,
      explicitlyBoundToHead: false,
      run: String(run.id),
      job: String(ciJob.id),
      attempt,
    },
    r0: {
      requirement: r0.requirement,
      receipt: r0.receipt,
      freeze: r0.freeze,
      frozenBlockers: r0.frozenBlockers,
      blockerClosures: r0.blockerClosures,
      reviewedHeadSha: r0.reviewedHeadSha,
      lineage: historicalIndependentReceipt ? 'descendant' : 'same_head',
      change: historicalIndependentReceipt ? 'semantic_descendant' : 'same',
      deltaConfirmation: 'unknown',
    },
    reviews: {
      r1: {
        requirement: reviews.r1.requirement,
        verdict: reviews.r1.verdict,
        receipt: reviews.r1.receipt,
        reviewedHeadSha: reviews.r1.reviewedHeadSha,
        reviewedBaseSha: reviews.r1.reviewedBaseSha,
        sourceRef: reviews.r1.sourceRef,
        reviewedAt: reviews.r1.reviewedAt,
        receiptId: reviews.r1.receiptId,
      },
      r2: {
        requirement: reviews.r2.requirement,
        verdict: reviews.r2.verdict,
        receipt: reviews.r2.receipt,
        reviewedHeadSha: reviews.r2.reviewedHeadSha,
        reviewedBaseSha: reviews.r2.reviewedBaseSha,
        sourceRef: reviews.r2.sourceRef,
        reviewedAt: reviews.r2.reviewedAt,
        receiptId: reviews.r2.receiptId,
      },
    },
    proofs: [],
    postMain: { status: 'not_applicable', mergeSha: null },
    sourceRefs,
  };

  const dispatcher = deriveDispatcherResult(observation);
  return {
    observation,
    evidence: {
      observedAt,
      question: 'Perform only the Dispatcher-selected independent review role for this exact current candidate.',
      sourceRefs,
      materialFacts: {
        taskRow: task.line,
        ci: { run: String(run.id), job: String(ciJob.id), attempt },
        priorReviewReceipts: {
          r1: reviews.r1.sourceRef,
          r2: reviews.r2.sourceRef,
        },
      },
      actionsAlreadyTaken: ['exact-head CI passed', 'current R0 receipt evaluated'],
      forbiddenScope: ['implementation edits', 'merge', 'TASKS status mutation', 'review scope expansion'],
    },
    dispatcher,
  };
}

function readJson(target) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
}

function readEvidenceDirectory(directory, repository, tasksFile) {
  const read = (name) => readJson(path.join(directory, name));
  return buildDevelopmentReviewObservation({
    repository,
    tasksText: readFileSync(path.resolve(process.cwd(), tasksFile), 'utf8'),
    pr: read('pr.json'),
    main: read('main.json'),
    runs: read('runs.json'),
    jobs: read('jobs.json'),
    prReviews: read('pr-reviews.json'),
    prComments: read('pr-comments.json'),
    reviewThreads: read('review-threads.json'),
  });
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'select-run') {
    const [runsFile, prFile] = args;
    if (!runsFile || !prFile) fail('USAGE_SELECT_RUN');
    const run = selectCurrentSuccessfulCiRun(readJson(runsFile), readJson(prFile));
    if (!run) fail('CURRENT_SUCCESSFUL_CI_MISSING');
    process.stdout.write(`${run.id}\n`);
    return;
  }
  if (command === 'build') {
    const [directory, repository, tasksFile = 'TASKS.md'] = args;
    if (!directory || !repository) fail('USAGE_BUILD');
    process.stdout.write(`${JSON.stringify(readEvidenceDirectory(directory, repository, tasksFile))}\n`);
    return;
  }
  fail('USAGE');
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'DEVELOPMENT_REVIEW_OBSERVATION_BLOCKED: UNKNOWN');
    process.exit(1);
  }
}
