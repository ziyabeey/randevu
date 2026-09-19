import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function verifyTaskBinding(tasksText, identity, repository) {
  const rows = String(tasksText ?? '').split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .map((line) => ({ line, cells: line.split('|').slice(1, -1).map((cell) => cell.trim()) }))
    .filter(({ cells }) => cells.length > 0 && taskIdFromCell(cells[0]) === identity.task);

  if (rows.length !== 1) blocked(rows.length === 0 ? 'TASK_NOT_IN_CANONICAL_TASKS' : 'TASK_BINDING_AMBIGUOUS');
  const prNeedle = `https://github.com/${repository}/pull/${identity.pr}`;
  if (!rows[0].line.includes(prNeedle)) blocked('TASK_PR_BINDING_MISSING');
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
  verifyTaskBinding(canonicalTasks, identity, repository);

  const api = `https://api.github.com/repos/${repository}`;
  const [pr, main, run, jobs] = await Promise.all([
    githubJson(fetchImpl, `${api}/pulls/${identity.pr}`, token),
    githubJson(fetchImpl, `${api}/branches/main`, token),
    githubJson(fetchImpl, `${api}/actions/runs/${identity.ci.run}`, token),
    githubJson(fetchImpl, `${api}/actions/runs/${identity.ci.run}/jobs?filter=all&per_page=100`, token),
  ]);

  if (pr?.state !== 'open'
      || pr?.head?.sha !== identity.head
      || pr?.base?.sha !== identity.base) blocked('LIVE_PR_IDENTITY_MISMATCH');
  if (main?.commit?.sha !== identity.main) blocked('LIVE_MAIN_IDENTITY_MISMATCH');

  if (String(run?.id ?? '') !== identity.ci.run
      || run?.head_sha !== identity.head
      || run?.conclusion !== 'success'
      || run?.status !== 'completed'
      || Number(run?.run_attempt) !== identity.ci.attempt
      || run?.path !== '.github/workflows/ci.yml') {
    blocked('LIVE_CI_RUN_MISMATCH');
  }

  const job = Array.isArray(jobs?.jobs)
    ? jobs.jobs.find((item) => String(item?.id ?? '') === identity.ci.job)
    : null;
  if (!job || job.name !== 'CI gate' || job.status !== 'completed' || job.conclusion !== 'success') {
    blocked('LIVE_CI_JOB_MISMATCH');
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
