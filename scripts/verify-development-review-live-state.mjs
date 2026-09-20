import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticatedReceipts, parseReviewerAllowlist } from './development-audit-gate.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const modulePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(modulePath), '..');

function blocked(reason) {
  throw new Error(`DEVELOPMENT_REVIEW_LIVE_STATE_BLOCKED: ${reason}`);
}

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA_RE.test(value)) blocked(`${label}_INVALID`);
  return value;
}

function requirePositiveId(value, label) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !POSITIVE_INT_RE.test(text)) blocked(`${label}_INVALID`);
  return text;
}

function requireTask(value) {
  if (typeof value !== 'string' || !value.trim()) blocked('TASK_ID_MISSING');
  return value.trim();
}

export function normalizeLiveReviewIdentity(input = {}) {
  if (input?.facts) {
    const facts = input.facts;
    const ci = facts.ci ?? {};
    return {
      task: requireTask(facts.task?.id ?? facts.candidate?.taskId),
      pr: Number(facts.candidate?.prNumber),
      head: requireSha(facts.candidate?.headSha, 'HEAD_SHA'),
      base: requireSha(facts.candidate?.baseMainSha, 'BASE_SHA'),
      main: requireSha(facts.observation?.liveMainSha ?? facts.observation?.observedMainSha, 'MAIN_SHA'),
      ci: {
        run: requirePositiveId(ci.run, 'CI_RUN'),
        job: requirePositiveId(ci.job, 'CI_JOB'),
        attempt: Number(requirePositiveId(ci.attempt, 'CI_ATTEMPT')),
        exactHeadSha: requireSha(ci.exactHeadSha, 'CI_HEAD_SHA'),
        testedCheckoutSha: requireSha(ci.testedCheckoutSha, 'TESTED_CHECKOUT_SHA'),
        baseMainSha: requireSha(ci.baseMainSha, 'CI_BASE_SHA'),
        explicitlyBoundToHead: ci.explicitlyBoundToHead === true,
        status: ci.status,
      },
    };
  }

  if (input?.schemaVersion === 'development-independent-review-request.v0') {
    const ci = input.currentEvidence?.ci ?? {};
    return {
      task: requireTask(input.case?.task),
      pr: Number(input.case?.pr),
      head: requireSha(input.case?.currentHead, 'HEAD_SHA'),
      base: requireSha(input.case?.baseMain, 'BASE_SHA'),
      main: requireSha(input.case?.currentMain, 'MAIN_SHA'),
      ci: {
        run: requirePositiveId(ci.run, 'CI_RUN'),
        job: requirePositiveId(ci.job, 'CI_JOB'),
        attempt: Number(requirePositiveId(ci.attempt, 'CI_ATTEMPT')),
        exactHeadSha: requireSha(ci.exactHeadSha, 'CI_HEAD_SHA'),
        testedCheckoutSha: requireSha(ci.testedCheckoutSha, 'TESTED_CHECKOUT_SHA'),
        baseMainSha: requireSha(ci.baseMainSha, 'CI_BASE_SHA'),
        explicitlyBoundToHead: ci.explicitlyBoundToHead === true,
        status: ci.status,
      },
    };
  }

  blocked('INPUT_SHAPE_INVALID');
}

function taskIdFromCell(cell) {
  const trimmed = cell.trim();
  const linked = trimmed.match(/^\[([^\]]+)\]\(/);
  return linked ? linked[1] : trimmed;
}

export function taskPrNumbersFromRow(row, repository) {
  const matches = Array.from(String(row ?? '').matchAll(
    /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?=[^0-9]|$)/g,
  ));
  return [...new Set(matches
    .filter((match) => match[1] === repository)
    .map((match) => Number(match[2])))]
    .sort((a, b) => a - b);
}

export function verifyTaskBinding(tasksText, identity, repository) {
  const rows = String(tasksText ?? '').split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .map((line) => ({ line, cells: line.split('|').slice(1, -1).map((cell) => cell.trim()) }))
    .filter(({ cells }) => cells.length > 0 && taskIdFromCell(cells[0]) === identity.task);

  if (rows.length !== 1) blocked(rows.length === 0 ? 'TASK_NOT_IN_CANONICAL_TASKS' : 'TASK_BINDING_AMBIGUOUS');
  const prNumbers = taskPrNumbersFromRow(rows[0].line, repository);
  if (!prNumbers.includes(identity.pr)) blocked('TASK_PR_BINDING_MISSING');
  return rows[0].line;
}

async function githubJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    blocked('GITHUB_API_UNAVAILABLE');
  }
  if (!response.ok) blocked(`GITHUB_API_HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    blocked('GITHUB_API_RESPONSE_INVALID');
  }
}

async function githubText(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    blocked('GITHUB_API_UNAVAILABLE');
  }
  if (!response.ok) blocked(`GITHUB_API_HTTP_${response.status}`);
  try {
    return await response.text();
  } catch {
    blocked('GITHUB_API_RESPONSE_INVALID');
  }
}

export function checkoutShaFromJobLogs(logText) {
  const lines = String(logText ?? '').split(/\r?\n/);
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('[command]/usr/bin/git log -1 --format=%H')) continue;
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const payload = lines[index + offset]
        .replace(/^\d{4}-\d{2}-\d{2}T[^ ]+Z\s+/, '')
        .trim();
      if (SHA_RE.test(payload)) {
        candidates.push(payload);
        break;
      }
      if (payload.startsWith('[command]') || payload.startsWith('##[')) break;
    }
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

async function githubCollection(fetchImpl, url, token) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = url.includes('?') ? '&' : '?';
    const items = await githubJson(fetchImpl, `${url}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(items)) blocked('GITHUB_COLLECTION_INVALID');
    all.push(...items);
    if (items.length < 100) return all;
  }
  blocked('GITHUB_COLLECTION_TOO_LARGE');
}

function defaultGit(args, root) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  });
}

export async function verifyDevelopmentReviewLiveState(input, {
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  root = repoRoot,
  fetchImpl = fetch,
  git = defaultGit,
  tasksText = null,
  reviewerAllowlist = parseReviewerAllowlist(process.env.DEVELOPMENT_REVIEWER_ALLOWLIST),
} = {}) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    blocked('REPOSITORY_INVALID');
  }
  if (typeof token !== 'string' || !token) blocked('GITHUB_TOKEN_MISSING');

  const identity = normalizeLiveReviewIdentity(input);
  if (!Number.isInteger(identity.pr) || identity.pr <= 0) blocked('PR_NUMBER_INVALID');
  if (identity.ci.status !== 'pass'
      || identity.ci.exactHeadSha !== identity.head
      || identity.ci.baseMainSha !== identity.main
      || identity.base !== identity.main) {
    blocked('CALLER_CI_OR_BASE_NOT_CURRENT');
  }

  const canonicalTasks = tasksText ?? readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  const taskRow = verifyTaskBinding(canonicalTasks, identity, repository);
  const taskPrNumbers = taskPrNumbersFromRow(taskRow, repository);

  const api = `https://api.github.com/repos/${repository}`;
  const otherTaskPrNumbers = taskPrNumbers.filter((number) => number !== identity.pr);
  const [pr, main, run, jobs, jobLogs, ...otherTaskPrs] = await Promise.all([
    githubJson(fetchImpl, `${api}/pulls/${identity.pr}`, token),
    githubJson(fetchImpl, `${api}/branches/main`, token),
    githubJson(fetchImpl, `${api}/actions/runs/${identity.ci.run}`, token),
    githubJson(
      fetchImpl,
      `${api}/actions/runs/${identity.ci.run}/attempts/${identity.ci.attempt}/jobs?per_page=100`,
      token,
    ),
    githubText(fetchImpl, `${api}/actions/jobs/${identity.ci.job}/logs`, token),
    ...otherTaskPrNumbers.map((number) => githubJson(fetchImpl, `${api}/pulls/${number}`, token)),
  ]);

  if (pr?.state !== 'open'
      || pr?.head?.sha !== identity.head
      || pr?.base?.sha !== identity.base) blocked('LIVE_PR_IDENTITY_MISMATCH');
  if (otherTaskPrs.some((item) => item?.state === 'open')) {
    blocked('TASK_OPEN_PR_BINDING_AMBIGUOUS');
  }
  if (main?.commit?.sha !== identity.main) blocked('LIVE_MAIN_IDENTITY_MISMATCH');

  const runPrNumbers = Array.isArray(run?.pull_requests)
    ? run.pull_requests.map((item) => Number(item?.number)).filter(Number.isInteger)
    : [];
  if (String(run?.id ?? '') !== identity.ci.run
      || run?.head_sha !== identity.head
      || run?.conclusion !== 'success'
      || run?.status !== 'completed'
      || run?.event !== 'pull_request'
      || !runPrNumbers.includes(identity.pr)
      || Number(run?.run_attempt) !== identity.ci.attempt
      || run?.path !== '.github/workflows/ci.yml') {
    blocked('LIVE_CI_RUN_MISMATCH');
  }

  const job = Array.isArray(jobs?.jobs)
    ? jobs.jobs.find((item) => String(item?.id ?? '') === identity.ci.job)
    : null;
  if (!job
      || job.name !== 'CI gate'
      || job.status !== 'completed'
      || job.conclusion !== 'success'
      || (job.run_attempt !== undefined && Number(job.run_attempt) !== identity.ci.attempt)) {
    blocked('LIVE_CI_JOB_MISMATCH');
  }

  const requestedRole = input?.schemaVersion === 'development-independent-review-request.v0'
    ? String(input?.role ?? '').toUpperCase()
    : null;
  if (requestedRole === 'R1' || requestedRole === 'R2') {
    const [comments, reviews, coordinationComments] = await Promise.all([
      githubCollection(fetchImpl, `${api}/issues/${identity.pr}/comments`, token),
      githubCollection(fetchImpl, `${api}/pulls/${identity.pr}/reviews`, token),
      githubCollection(fetchImpl, `${api}/issues/65/comments`, token),
    ]);
    const roleReceipts = authenticatedReceipts(
      [...comments, ...reviews, ...coordinationComments],
      pr,
      reviewerAllowlist,
    ).filter((entry) => entry.role === requestedRole);
    const currentReceipts = roleReceipts.filter((entry) => entry.freshness === 'current');

    const reviewMode = input?.reviewMode;
    if (reviewMode === 'FOLLOW_UP') {
      const previous = input?.currentEvidence?.review ?? {};
      const previousSourceRef = typeof previous.previousReceiptSourceRef === 'string'
        ? previous.previousReceiptSourceRef
        : null;
      const previousObservedAt = previous.previousReceiptObservedAt;
      const previousId = previous.previousReceiptId;
      const previousHead = previous.previousReviewedHeadSha;
      const previousBase = previous.previousReviewedBaseSha;
      const sourcePrefix = `https://github.com/${repository}/pull/${identity.pr}#`;
      if (!Number.isSafeInteger(previousId) || previousId <= 0
          || typeof previousObservedAt !== 'number' || !Number.isFinite(previousObservedAt)
          || previousObservedAt <= 0
          || !SHA_RE.test(previousHead ?? '') || !SHA_RE.test(previousBase ?? '')
          || ![`${sourcePrefix}issuecomment-${previousId}`, `${sourcePrefix}pullrequestreview-${previousId}`]
            .includes(previousSourceRef)) {
        blocked('FOLLOW_UP_RECEIPT_SNAPSHOT_MISSING');
      }
      // A caller-supplied snapshot is not permission to open another paid lane.
      // Re-authenticate its exact native identity, including historical receipts.
      const represented = roleReceipts.filter((entry) => entry.url === previousSourceRef
        && entry.id === previousId && entry.observedAt === previousObservedAt
        && entry.headSha === previousHead && entry.baseSha === previousBase);
      if (represented.length !== 1) blocked('FOLLOW_UP_RECEIPT_NOT_AUTHENTICATED');
      const prior = represented[0];
      const applicable = currentReceipts.length ? currentReceipts : roleReceipts;
      // Match observation selection: exact-current first, then newest historical.
      // Superseded or equal-time ambiguous evidence cannot mint another reservation.
      if (!applicable.includes(prior)
          || applicable.some((entry) => entry !== prior && entry.observedAt >= previousObservedAt)
          || (prior.freshness === 'current' && prior.verdict !== 'INCOMPLETE')) {
        blocked(`${requestedRole}_REVIEW_ALREADY_RECEIVED`);
      }
    } else if (currentReceipts.length > 0) {
      blocked(`${requestedRole}_REVIEW_ALREADY_RECEIVED`);
    }
  }

  const loggedCheckoutSha = checkoutShaFromJobLogs(jobLogs);
  if (!loggedCheckoutSha) blocked('LIVE_CI_CHECKOUT_LOG_UNVERIFIABLE');
  if (loggedCheckoutSha !== identity.ci.testedCheckoutSha) {
    blocked('LIVE_CI_TESTED_CHECKOUT_MISMATCH');
  }

  let checkoutBinding = 'raw_head';
  if (identity.ci.testedCheckoutSha !== identity.head) {
    if (!identity.ci.explicitlyBoundToHead) blocked('TESTED_CHECKOUT_UNBOUND');
    const fetched = git(['fetch', '--quiet', '--no-tags', 'origin', `refs/pull/${identity.pr}/merge`], root);
    if (fetched?.error || fetched?.status !== 0) blocked('LIVE_MERGE_REF_UNAVAILABLE');
    const resolved = git(['rev-parse', 'FETCH_HEAD'], root);
    if (resolved?.error || resolved?.status !== 0) blocked('LIVE_MERGE_REF_UNAVAILABLE');
    if (String(resolved.stdout ?? '').trim() !== identity.ci.testedCheckoutSha) {
      blocked('TESTED_CHECKOUT_LIVE_MERGE_REF_MISMATCH');
    }
    checkoutBinding = 'live_merge_ref';
  }

  return {
    status: 'LIVE_REVIEW_STATE_VERIFIED',
    task: identity.task,
    pr: identity.pr,
    head: identity.head,
    base: identity.base,
    main: identity.main,
    ciRun: identity.ci.run,
    ciJob: identity.ci.job,
    ciAttempt: identity.ci.attempt,
    checkoutBinding,
  };
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error('Usage: verify-development-review-live-state <identity.json>');
  const input = JSON.parse(readFileSync(path.resolve(process.cwd(), target), 'utf8'));
  console.log(JSON.stringify(await verifyDevelopmentReviewLiveState(input), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'DEVELOPMENT_REVIEW_LIVE_STATE_BLOCKED: UNKNOWN';
    console.error(message.startsWith('DEVELOPMENT_REVIEW_LIVE_STATE_BLOCKED:')
      ? message
      : 'DEVELOPMENT_REVIEW_LIVE_STATE_BLOCKED: UNKNOWN');
    process.exit(1);
  });
}
