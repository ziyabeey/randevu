import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CHOICES,
  automaticActionAllowed,
  canonicalTaskBinding,
  ciForPull,
  classifyPull,
  compactReviewEvidence,
  depotRunHardInvalidation,
  dispatchNotificationEvents,
  githubPollIntervalSeconds,
  notificationEvent,
  parseTasksSnapshot,
  policyFingerprint,
  receiptEvidenceBody,
  safeDepotMaxConcurrentRuns,
  validateQwenChoices,
} from './policy.mjs';
import {
  applyDepotEvidence,
  createDepotLaunchReservation,
  depotCommentBody,
  depotEligible,
  depotFetchRef,
  isDepotTerminal,
  normalizeDepotStatus,
  qwenEligibleDecisions,
  workflowHash,
} from './depot.mjs';
import { acquireDirectoryLease, releaseDirectoryLease } from './lease.mjs';
import {
  buildJanitorCandidates,
  janitorFingerprintInput,
  validateJanitorChoices,
} from './janitor.mjs';

const root = path.resolve(
  process.env.QWEN_COORDINATOR_HOME
    ?? path.join(homedir(), '.local', 'share', 'qwen-coordinator'),
);
const configFile = path.join(root, 'config.json');
const stateFile = path.join(root, 'state/runtime.json');
const reportJsonFile = path.join(root, 'reports/latest.json');
const reportMarkdownFile = path.join(root, 'reports/latest.md');
const actionQueueFile = path.join(root, 'reports/action-queue.json');
const logFile = path.join(root, 'logs/coordinator.jsonl');
const lockDir = path.join(root, 'state/run.lock');
let lockToken = null;

for (const directory of ['state', 'reports', 'logs']) {
  mkdirSync(path.join(root, directory), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, file);
}

function persistRuntimeState(state) {
  writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function log(event, details = {}) {
  appendFileSync(logFile, `${JSON.stringify({ at: nowIso(), event, ...details })}\n`, { mode: 0o600 });
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? 10_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function acquireLock() {
  lockToken = acquireDirectoryLease(lockDir);
  return lockToken !== null;
}

function releaseLock() {
  const released = releaseDirectoryLease(lockDir, lockToken);
  if (!released) log('lock-release-skipped-owner-mismatch');
  lockToken = null;
}

function git(repoRoot, args) {
  return command('/usr/bin/git', ['-c', 'core.fsmonitor=false', '-C', repoRoot, ...args]);
}

function gatherLocal(config) {
  const head = git(config.repoRoot, ['rev-parse', 'HEAD']);
  const branch = git(config.repoRoot, ['branch', '--show-current']);
  const status = git(config.repoRoot, ['status', '--porcelain=v1', '-uno']);
  return {
    available: head.ok,
    headSha: head.ok ? head.stdout : null,
    branch: branch.ok ? branch.stdout : null,
    worktreeClean: status.ok ? status.stdout.length === 0 : null,
    errors: [head, branch, status]
      .filter((result) => !result.ok && result.stderr)
      .map((result) => result.stderr.slice(0, 500)),
  };
}

function getGithubToken() {
  const result = command('gh', ['auth', 'token'], { timeout: 5_000 });
  return result.ok && result.stdout ? result.stdout : null;
}

async function githubJson(url, token, options = {}) {
  if (!token) {
    const endpoint = url === 'https://api.github.com/graphql'
      ? 'graphql'
      : url.replace(/^https:\/\/api\.github\.com\//, '');
    const args = ['api', endpoint, '--method', options.method ?? 'GET'];
    if (options.body !== undefined) args.push('--input', '-');
    const result = command('gh', args, {
      timeout: options.timeout ?? 20_000,
      input: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!result.ok) {
      throw new Error(`GitHub CLI failed: ${result.stderr.slice(0, 500)}`);
    }
    return {
      data: result.stdout ? JSON.parse(result.stdout) : null,
      metadata: { status: 200, rateLimitRemaining: null, rateLimitReset: null },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 20_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yzt-local-qwen-coordinator/2',
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw.slice(0, 1000) };
      }
    }
    const metadata = {
      status: response.status,
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
      rateLimitReset: response.headers.get('x-ratelimit-reset'),
    };
    if (!response.ok) {
      const error = new Error(`GitHub HTTP ${response.status}: ${String(data?.message ?? raw).slice(0, 500)}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return { data, metadata };
  } finally {
    clearTimeout(timer);
  }
}

const PROJECT_QUERY = `
query CoordinatorSnapshot($owner:String!,$name:String!,$limit:Int!,$mergedLimit:Int!,$coordinationIssue:Int!,$tasksExpression:String!){
  rateLimit{cost remaining resetAt}
  repository(owner:$owner,name:$name){
    defaultBranchRef{
      name
      target{
        ... on Commit{
          oid
          statusCheckRollup{
            state
            contexts(first:100){
              pageInfo{hasNextPage}
              nodes{
                __typename
                ... on CheckRun{name status conclusion detailsUrl startedAt completedAt}
                ... on StatusContext{context state targetUrl createdAt}
              }
            }
          }
        }
      }
    }
    taskBlob: object(expression:$tasksExpression){... on Blob{oid text isTruncated}}
    pullRequests(first:$limit,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage}
      nodes{
        id number title isDraft state url createdAt updatedAt author{login}
        baseRefName baseRefOid headRefName headRefOid
        mergeable mergeStateStatus isCrossRepository reviewDecision
        files(first:100){totalCount pageInfo{hasNextPage} nodes{path additions deletions changeType}}
        reviews(last:50){pageInfo{hasPreviousPage} nodes{databaseId state submittedAt body url author{login} commit{oid}}}
        comments(last:100){pageInfo{hasPreviousPage} nodes{databaseId body createdAt updatedAt url author{login}}}
        reviewThreads(first:100){totalCount pageInfo{hasNextPage} nodes{isResolved}}
        commits(last:1){nodes{commit{
          oid
          statusCheckRollup{
            state
            contexts(first:100){
              pageInfo{hasNextPage}
              nodes{
                __typename
                ... on CheckRun{name status conclusion detailsUrl startedAt completedAt}
                ... on StatusContext{context state targetUrl createdAt}
              }
            }
          }
        }}}
      }
    }
    recentMergedPullRequests: pullRequests(first:$mergedLimit,states:[MERGED],orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{
        number title url createdAt updatedAt mergedAt
        files(first:100){totalCount pageInfo{hasNextPage} nodes{path additions deletions changeType}}
      }
    }
    issue(number:$coordinationIssue){
      comments(last:100){pageInfo{hasPreviousPage} nodes{databaseId body createdAt updatedAt url author{login}}}
    }
  }
}`;

function compactText(value, limit = 8000) {
  return String(value ?? '').slice(0, limit);
}

function compactComment(node) {
  return {
    id: node.databaseId ?? null,
    author: node.author?.login ?? null,
    body: receiptEvidenceBody(node.body),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    url: node.url ?? null,
  };
}

function compactCheck(node) {
  if (node.__typename === 'StatusContext') {
    return {
      type: 'StatusContext',
      name: node.context ?? null,
      status: node.state === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
      conclusion: node.state ?? null,
      url: node.targetUrl ?? null,
      startedAt: node.createdAt ?? null,
      completedAt: node.createdAt ?? null,
    };
  }
  return {
    type: 'CheckRun',
    name: node.name ?? null,
    status: node.status ?? null,
    conclusion: node.conclusion ?? null,
    url: node.detailsUrl ?? null,
    startedAt: node.startedAt ?? null,
    completedAt: node.completedAt ?? null,
  };
}

function compactPull(node) {
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  const threads = node.reviewThreads?.nodes ?? [];
  return {
    nodeId: node.id,
    number: node.number,
    title: compactText(node.title, 240),
    author: node.author?.login ?? null,
    draft: node.isDraft === true,
    state: node.state ?? null,
    url: node.url ?? null,
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    baseRef: node.baseRefName ?? null,
    baseSha: node.baseRefOid ?? null,
    headRef: node.headRefName ?? null,
    headSha: node.headRefOid ?? null,
    mergeable: node.mergeable ?? 'UNKNOWN',
    mergeStateStatus: node.mergeStateStatus ?? 'UNKNOWN',
    fromFork: node.isCrossRepository === true,
    reviewDecision: node.reviewDecision ?? null,
    files: (node.files?.nodes ?? []).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      changeType: file.changeType,
    })),
    filesTruncated: node.files?.pageInfo?.hasNextPage === true,
    fileCount: node.files?.totalCount ?? 0,
    reviews: (node.reviews?.nodes ?? []).map(compactReviewEvidence),
    reviewsTruncated: node.reviews?.pageInfo?.hasPreviousPage === true,
    comments: (node.comments?.nodes ?? []).map(compactComment),
    commentsTruncated: node.comments?.pageInfo?.hasPreviousPage === true,
    unresolvedThreads: threads.filter((thread) => thread.isResolved === false).length,
    threadCount: node.reviewThreads?.totalCount ?? threads.length,
    threadsTruncated: node.reviewThreads?.pageInfo?.hasNextPage === true,
    checks: (rollup?.contexts?.nodes ?? []).map(compactCheck),
    checksTruncated: rollup?.contexts?.pageInfo?.hasNextPage === true,
    checkRollupState: rollup?.state ?? null,
  };
}

function compactMergedPull(node) {
  return {
    number: node.number,
    title: compactText(node.title, 240),
    url: node.url ?? null,
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    mergedAt: node.mergedAt ?? null,
    files: (node.files?.nodes ?? []).map((entry) => ({
      path: entry.path,
      additions: entry.additions,
      deletions: entry.deletions,
      changeType: entry.changeType,
    })),
    filesTruncated: node.files?.pageInfo?.hasNextPage === true,
    fileCount: node.files?.totalCount ?? 0,
  };
}

async function fetchSnapshot(config, token) {
  const [owner, name] = config.repoSlug.split('/');
  const result = await githubJson('https://api.github.com/graphql', token, {
    method: 'POST',
    body: {
      query: PROJECT_QUERY,
      variables: {
        owner,
        name,
        limit: config.maxOpenPullRequests,
        mergedLimit: config.janitorRecentMergedPullRequests ?? 30,
        coordinationIssue: config.coordinationIssueNumber,
        tasksExpression: `${config.defaultBranch}:TASKS.md`,
      },
    },
  });
  if (result.data?.errors?.length) {
    throw new Error(`GitHub GraphQL: ${result.data.errors.map((error) => error.message).join('; ')}`);
  }
  const repository = result.data?.data?.repository;
  if (!repository?.defaultBranchRef?.target?.oid) throw new Error('GitHub snapshot default branch bilgisi içermiyor');
  const taskSource = repository.taskBlob?.text ?? '';
  const taskSnapshot = parseTasksSnapshot(taskSource, config.maxTaskRows);
  const mainRollup = repository.defaultBranchRef.target.statusCheckRollup ?? null;
  return {
    schemaVersion: 4,
    available: true,
    complete: repository.pullRequests?.pageInfo?.hasNextPage !== true
      && repository.taskBlob?.isTruncated !== true
      && taskSnapshot.truncated !== true
      && mainRollup?.contexts?.pageInfo?.hasNextPage !== true,
    auth: 'authenticated',
    fetchedAt: nowIso(),
    refreshed: true,
    rateLimitRemaining: result.data?.data?.rateLimit?.remaining ?? result.metadata.rateLimitRemaining,
    rateLimitCost: result.data?.data?.rateLimit?.cost ?? null,
    rateLimitReset: result.data?.data?.rateLimit?.resetAt ?? result.metadata.rateLimitReset,
    mainBranch: repository.defaultBranchRef.name,
    mainSha: repository.defaultBranchRef.target.oid,
    mainChecks: (mainRollup?.contexts?.nodes ?? []).map(compactCheck),
    mainChecksTruncated: mainRollup?.contexts?.pageInfo?.hasNextPage === true,
    taskBlobOid: repository.taskBlob?.oid ?? null,
    taskSource,
    tasks: taskSnapshot.rows,
    tasksTruncated: taskSnapshot.truncated,
    taskRowCount: taskSnapshot.totalRows,
    pulls: (repository.pullRequests?.nodes ?? []).map(compactPull),
    recentMergedPulls: (repository.recentMergedPullRequests?.nodes ?? []).map(compactMergedPull),
    coordinationComments: (repository.issue?.comments?.nodes ?? []).map(compactComment),
    coordinationCommentsTruncated: repository.issue?.comments?.pageInfo?.hasPreviousPage === true,
    errors: taskSnapshot.truncated ? ['TASKS row limit exceeded; snapshot is incomplete'] : [],
  };
}

async function gatherRemote(config, previousState, options = {}) {
  const previous = previousState.remoteCache ?? null;
  const lastFetchMs = Date.parse(previous?.fetchedAt ?? '') || 0;
  const pollSeconds = githubPollIntervalSeconds(previousState, config);
  const due = options.force === true
    || !previous
    || previous.schemaVersion !== 4
    || Date.now() - lastFetchMs >= pollSeconds * 1000;
  if (!due) return { ...previous, refreshed: false };
  const token = getGithubToken();
  try {
    return await fetchSnapshot(config, token);
  } catch (error) {
    const fallback = previous?.schemaVersion === 4 ? previous : {
      schemaVersion: 4,
      pulls: [],
      recentMergedPulls: [],
      tasks: [],
      coordinationComments: [],
      mainChecks: [],
    };
    log('snapshot-failed', { error: error.message });
    return {
      ...fallback,
      available: false,
      complete: false,
      auth: 'authenticated',
      refreshed: false,
      errors: [`snapshot: ${error.message}`],
    };
  }
}

function taskForPull(pr, remote, state) {
  const binding = canonicalTaskBinding(remote.tasks, remote.pulls, pr.number);
  if (binding.task) return binding.task;
  if (binding.reason !== 'TASK_NOT_MAPPED') return null;
  const closure = state.closurePulls?.[String(pr.number)];
  if (!closure) return null;
  return {
    id: `${closure.taskId}-CLOSEOUT`,
    title: `Coordinator closeout for ${closure.taskId}`,
    status: 'İncelemede',
    owner: 'Qwen local coordinator',
    prNumbers: [pr.number],
    evidence: `PR #${pr.number} docs-only coordinator closeout`,
    syntheticClosure: true,
  };
}

function buildDecisions(config, remote, state) {
  return (remote.pulls ?? []).map((pr) => {
    const task = taskForPull(pr, remote, state);
    const pullEvidenceComplete = pr.reviewsTruncated !== true
      && pr.commentsTruncated !== true
      && pr.checksTruncated !== true;
    const result = classifyPull(pr, {
      config,
      mainSha: remote.mainSha,
      task,
      coordinationComments: remote.coordinationComments,
      coordinationCommentsComplete: remote.coordinationCommentsTruncated !== true,
      remoteComplete: remote.available === true
        && remote.complete === true
        && pullEvidenceComplete,
    });
    return {
      ...result,
      title: pr.title,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      draft: pr.draft,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      url: pr.url,
      syntheticClosure: task?.syntheticClosure === true,
    };
  });
}

function depotCommand(config, args, cwd, timeout = 30_000) {
  return command(config.depotBinary, args, { cwd, timeout });
}

function getDepotToken(config) {
  const result = depotCommand(config, ['login', 'token'], config.repoRoot, 5_000);
  if (!result.ok || !result.stdout) throw new Error(`Depot token unavailable: ${compactText(result.stderr, 300)}`);
  return result.stdout;
}

async function depotApi(pathname, token, body, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`https://api.depot.dev/${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: compactText(raw, 500) }; }
    if (!response.ok) throw new Error(`Depot API HTTP ${response.status}: ${compactText(data?.message ?? raw, 500)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function startDepotRun(config, pr, beforeLaunch = () => {}) {
  let expectedTree = git(config.repoRoot, ['rev-parse', `${pr.headSha}^{tree}`]);
  if (!expectedTree.ok) {
    const { remoteRef, localRef } = depotFetchRef(pr);
    const fetched = git(config.repoRoot, [
      'fetch', '--no-tags', '--force', 'origin', `${remoteRef}:${localRef}`,
    ]);
    if (!fetched.ok) {
      throw new Error(`Depot head fetch failed: ${fetched.stderr.slice(0, 500)}`);
    }
    const observedHead = git(config.repoRoot, ['rev-parse', localRef]);
    if (!observedHead.ok || observedHead.stdout !== pr.headSha) {
      throw new Error('Depot fetched branch no longer matches the observed exact PR head');
    }
    expectedTree = git(config.repoRoot, ['rev-parse', `${pr.headSha}^{tree}`]);
  }
  if (!expectedTree.ok || !/^[a-f0-9]{40}$/.test(expectedTree.stdout)) {
    throw new Error(`Depot head tree identity unavailable: ${expectedTree.stderr.slice(0, 500)}`);
  }
  const template = readFileSync(config.depotWorkflowFile, 'utf8');
  if (!template.includes('__EXPECTED_HEAD_SHA__') || !template.includes('__EXPECTED_BASE_SHA__')
    || !template.includes('__EXPECTED_TREE_SHA__')) throw new Error('Depot workflow identity placeholders are missing');
  const source = template
    .replaceAll('__EXPECTED_HEAD_SHA__', pr.headSha)
    .replaceAll('__EXPECTED_BASE_SHA__', pr.baseSha)
    .replaceAll('__EXPECTED_TREE_SHA__', expectedTree.stdout);
  const runtimeWorkflow = path.join(root, 'state', `depot-workflow-${pr.headSha}.yml`);
  writeAtomic(runtimeWorkflow, source);
  const hash = workflowHash(source);
  const token = getDepotToken(config);
  beforeLaunch({ workflowHash: hash, treeSha: expectedTree.stdout });
  const response = await depotApi('depot.ci.v1.CIService/Run', token, {
    repo: config.repoSlug,
    sha: pr.headSha,
    workflowContent: [source],
    job: config.depotJob,
    forge: 'FORGE_GITHUB',
  }, config.depotStartTimeoutSeconds * 1000);
  const runId = response?.runId ?? response?.run_id ?? null;
  if (!runId) throw new Error('Depot Run API response did not include runId');
  return {
    prNumber: pr.number,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    headRef: pr.headRef,
    runId,
    status: 'queued',
    workflowHash: hash,
    treeSha: expectedTree.stdout,
    launchMode: 'api-exact-sha',
    workflowName: config.depotWorkflowName,
    startedAt: nowIso(),
    pollErrors: 0,
    startAttempts: 1,
    commentPublished: false,
  };
}

function cancelDepotRun(config, run) {
  if (isDepotTerminal(run.status)) return true;
  if (!run.runId) return !['launch-reserved', 'launch-uncertain'].includes(run.status);
  if (run.cancelRequestedAt) {
    pollDepotRun(config, run);
    return isDepotTerminal(run.status);
  }
  const lastAttempt = Date.parse(run.lastCancelAttemptAt ?? '') || 0;
  if (lastAttempt && Date.now() - lastAttempt < config.depotRetrySeconds * 1000) return false;
  run.lastCancelAttemptAt = nowIso();
  const result = depotCommand(config, [
    'ci', 'cancel', run.runId, '--org', config.depotOrgId, '--output', 'json',
  ], config.repoRoot, 20_000);
  log(result.ok ? 'depot-cancelled' : 'depot-cancel-failed', {
    prNumber: run.prNumber,
    headSha: run.headSha,
    runId: run.runId,
    error: result.ok ? null : compactText(result.stderr, 500),
  });
  if (!result.ok) {
    run.cancelError = compactText(result.stderr, 700);
    return false;
  }
  run.cancelRequestedAt = nowIso();
  run.status = 'cancelling';
  delete run.cancelError;
  pollDepotRun(config, run);
  return isDepotTerminal(run.status);
}

function pollDepotRun(config, run) {
  const result = depotCommand(config, [
    'ci', 'status', run.runId, '--org', config.depotOrgId, '--output', 'json',
  ], config.repoRoot, 20_000);
  if (!result.ok) {
    run.pollErrors = (run.pollErrors ?? 0) + 1;
    run.lastPollError = compactText(result.stderr, 700);
    run.lastPolledAt = nowIso();
    return;
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    run.pollErrors = (run.pollErrors ?? 0) + 1;
    run.lastPollError = 'Depot status response was not JSON';
    run.lastPolledAt = nowIso();
    return;
  }
  const normalized = normalizeDepotStatus(payload);
  if (normalized.status !== 'unknown') run.status = normalized.status;
  run.viewUrl = normalized.viewUrl ?? run.viewUrl ?? null;
  run.failedJobs = normalized.failedJobs;
  run.rawStatus = normalized.rawStatus;
  run.lastPolledAt = nowIso();
  run.pollErrors = 0;
  delete run.lastPollError;
  if (['pass', 'fail'].includes(run.status)) {
    const identityResult = depotCommand(config, [
      'ci', 'run', 'show', run.runId, '--org', config.depotOrgId, '--output', 'json',
    ], config.repoRoot, 20_000);
    if (!identityResult.ok) {
      run.status = 'verifying';
      run.identityError = compactText(identityResult.stderr, 700);
      return;
    }
    let identity;
    try {
      identity = JSON.parse(identityResult.stdout);
    } catch {
      run.status = 'verifying';
      run.identityError = 'Depot run identity response was not JSON';
      return;
    }
    run.observedSha = identity.sha ?? null;
    run.observedHeadSha = identity.head_sha ?? identity.headSha ?? null;
    run.identityVerified = run.observedSha === run.headSha || run.observedHeadSha === run.headSha;
    delete run.identityError;
    if (!run.identityVerified) run.status = 'identity-error';
  }
  if (isDepotTerminal(run.status) && !run.completedAt) run.completedAt = nowIso();
}

async function publishDepotComment(config, remote, run) {
  if (!['pass', 'fail', 'identity-error'].includes(run.status)
    || (run.commentPublished && run.commentSchemaVersion === config.depotCommentSchemaVersion)) return;
  if (config.mode !== 'guarded'
    || config.writeActionsEnabled !== true
    || !automaticActionAllowed(config, 'UPDATE_DEPOT_COMMENT')) return;
  const token = getGithubToken();
  const baseUrl = `https://api.github.com/repos/${config.repoSlug}`;
  const live = await githubJson(`${baseUrl}/pulls/${run.prNumber}`, token);
  if (live.data?.state !== 'open' || live.data?.head?.sha !== run.headSha || live.data?.base?.sha !== run.baseSha) {
    run.status = 'superseded';
    run.completedAt ??= nowIso();
    return;
  }
  const marker = '<!-- qwen-local-coordinator:depot-shadow-ci -->';
  const snapshotPr = remote.pulls.find((pr) => pr.number === run.prNumber);
  const existing = snapshotPr?.comments?.find((comment) => comment.body.includes(marker));
  const body = depotCommentBody(run, run.workflowName);
  const response = existing
    ? await githubJson(`${baseUrl}/issues/comments/${existing.id}`, token, { method: 'PATCH', body: { body } })
    : await githubJson(`${baseUrl}/issues/${run.prNumber}/comments`, token, { method: 'POST', body: { body } });
  run.commentPublished = true;
  run.commentSchemaVersion = config.depotCommentSchemaVersion;
  run.commentId = response.data?.id ?? existing?.id ?? null;
  run.commentUrl = response.data?.html_url ?? response.data?.url ?? existing?.url ?? null;
  run.commentPublishedAt = nowIso();
  log('depot-comment-published', {
    prNumber: run.prNumber,
    headSha: run.headSha,
    runId: run.runId,
    status: run.status,
    commentId: run.commentId,
  });
}

async function reconcileDepot(config, remote, decisions, state) {
  state.depotRuns ??= {};
  if (config.depotShadowEnabled !== true
    || !automaticActionAllowed(config, 'RUN_DEPOT')) return;
  if (remote.available !== true || remote.complete !== true) {
    log('depot-reconcile-skipped-incomplete-remote');
    return;
  }
  const openByNumber = new Map((remote.pulls ?? []).map((pr) => [String(pr.number), pr]));

  for (const [number, run] of Object.entries(state.depotRuns)) {
    const pr = openByNumber.get(number);
    if (!pr || pr.headSha !== run.headSha || pr.baseSha !== run.baseSha) {
      const terminal = cancelDepotRun(config, run);
      if (terminal && run.status !== 'cancelled') run.status = 'superseded';
      if (terminal) run.completedAt ??= nowIso();
      continue;
    }
    const baseDecision = decisions.find((decision) => decision.prNumber === run.prNumber);
    const structurallyInvalid = depotRunHardInvalidation(baseDecision);
    if (structurallyInvalid && !isDepotTerminal(run.status)) {
      const terminal = cancelDepotRun(config, run);
      if (terminal && run.status !== 'cancelled') run.status = 'superseded';
      if (terminal) run.completedAt ??= nowIso();
      continue;
    }
    if (run.runId && (!isDepotTerminal(run.status) || run.identityVerified == null)) pollDepotRun(config, run);
    if (['pass', 'fail', 'identity-error'].includes(run.status)
      && (!run.commentPublished || run.commentSchemaVersion !== config.depotCommentSchemaVersion)) {
      try {
        await publishDepotComment(config, remote, run);
      } catch (error) {
        run.commentError = compactText(error.message, 700);
        log('depot-comment-failed', { prNumber: run.prNumber, runId: run.runId, error: error.message });
      }
    }
  }

  const active = Object.values(state.depotRuns).filter((run) => !isDepotTerminal(run.status) && run.status !== 'start-error').length;
  const maxRuns = safeDepotMaxConcurrentRuns(config.depotMaxConcurrentRuns);
  if (active >= maxRuns) return;
  const candidates = decisions
    .map((decision) => ({ decision, pr: remote.pulls.find((item) => item.number === decision.prNumber) }))
    .filter(({ decision, pr }) => depotEligible(pr, decision, config))
    .filter(({ pr }) => {
      const prior = state.depotRuns[String(pr.number)];
      if (!prior || prior.headSha !== pr.headSha || prior.baseSha !== pr.baseSha) return true;
      const retryFailedBackfill = prior.status === 'fail'
        && Array.isArray(config.depotBackfillPullNumbers)
        && config.depotBackfillPullNumbers.includes(pr.number);
      if (prior.status !== 'start-error' && !retryFailedBackfill) return false;
      const last = Date.parse(prior.lastStartAttemptAt ?? prior.startedAt ?? '') || 0;
      return (prior.startAttempts ?? 0) < config.depotMaximumStartAttempts
        && Date.now() - last >= config.depotRetrySeconds * 1000;
    })
    .sort((left, right) => left.pr.number - right.pr.number);
  const candidate = candidates[0];
  if (!candidate) return;
  const previous = state.depotRuns[String(candidate.pr.number)];
  let reservation = null;
  try {
    const run = await startDepotRun(config, candidate.pr, (prepared) => {
      reservation = {
        ...createDepotLaunchReservation(candidate.pr, previous, nowIso()),
        ...prepared,
      };
      state.depotRuns[String(candidate.pr.number)] = reservation;
      persistRuntimeState(state);
    });
    if (!reservation) throw new Error('Depot launch was not durably reserved');
    state.depotRuns[String(candidate.pr.number)] = {
      ...reservation,
      ...run,
      startAttempts: reservation.startAttempts,
      launchReservationId: reservation.launchReservationId,
      launchReservedAt: reservation.launchReservedAt,
    };
    persistRuntimeState(state);
    log('depot-started', { prNumber: run.prNumber, headSha: run.headSha, runId: run.runId, workflowHash: run.workflowHash });
  } catch (error) {
    const failed = reservation ?? createDepotLaunchReservation(candidate.pr, previous, nowIso());
    const failureStatus = reservation ? 'launch-uncertain' : 'start-error';
    state.depotRuns[String(candidate.pr.number)] = {
      ...failed,
      status: failureStatus,
      lastStartAttemptAt: nowIso(),
      error: compactText(error.message, 1000),
    };
    persistRuntimeState(state);
    log(failureStatus === 'launch-uncertain' ? 'depot-start-uncertain' : 'depot-start-failed', {
      prNumber: candidate.pr.number,
      headSha: candidate.pr.headSha,
      launchReservationId: failed.launchReservationId,
      error: error.message,
    });
  }
}

function attachDepotEvidence(decisions, state) {
  return decisions.map((decision) => applyDepotEvidence(decision, state.depotRuns?.[String(decision.prNumber)]));
}

function extractJson(value) {
  const source = String(value ?? '').trim();
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error('Qwen response did not contain a JSON object');
  }
}

async function askQwen(config, decisions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.qwenTimeoutSeconds * 1000);
  try {
    const modelResponse = await fetch(`${config.qwenEndpoint}/v1/models`, { signal: controller.signal });
    if (!modelResponse.ok) throw new Error(`model endpoint HTTP ${modelResponse.status}`);
    const models = await modelResponse.json();
    const model = models.data?.[0]?.id;
    if (!model) throw new Error('no local model is available');
    const system = 'PR sınıflandır. A=WAIT, B=REPAIR, C=REVIEW, D=MERGE. Her kaydın policy alanı deterministik üst sınırdır; daha ileri karar verme. CI fail veya conflict B; kanıt/base/task eksik A; review eksik C; D yalnız üst sınır D ise. Her sonucu exact prNumber anahtarıyla döndür. Yalnız JSON: {"choices":{"208":"D"}}.';
    const payload = decisions.map((decision) => ({
      prNumber: decision.prNumber,
      policy: decision.choice,
      ci: decision.ci.status,
      mergeable: decision.mergeable,
      draft: decision.draft ? 1 : 0,
      missingReviews: decision.missingReviews.join(','),
    }));
    const response = await fetch(`${config.qwenEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ rows: payload }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`completion endpoint HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    try {
      return { model, ...validateQwenChoices(extractJson(content), decisions) };
    } catch (error) {
      log('qwen-invalid-response', { error: error.message, sample: compactText(content, 500) });
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function askJanitorQwen(config, candidates) {
  const controller = new AbortController();
  const timeoutSeconds = config.janitorTimeoutSeconds ?? config.qwenTimeoutSeconds ?? 60;
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const modelResponse = await fetch(`${config.qwenEndpoint}/v1/models`, { signal: controller.signal });
    if (!modelResponse.ok) throw new Error(`model endpoint HTTP ${modelResponse.status}`);
    const models = await modelResponse.json();
    const model = models.data?.[0]?.id;
    if (!model) throw new Error('no local model is available');
    const system = [
      'Repo hijyeni sınıflandır.',
      'Her satırın status ve allowedChoices alanı deterministik sınırdır.',
      'Kanıt icat etme ve allowedChoices dışına çıkma.',
      'CLOSE_CANDIDATE yalnız superseded/duplicate adaylarında bir insan inceleme önerisidir; hiçbir şeyi kapatmaz.',
      'REVIEW_CAPACITY kod hatası değildir.',
      'Yalnız exact PR anahtarlı JSON döndür: {"choices":{"248":"CLOSE_CANDIDATE"}}.',
    ].join(' ');
    const rows = candidates.map((item) => ({
      prNumber: item.prNumber,
      title: item.title,
      taskKey: item.taskKey,
      status: item.status,
      reason: item.reason,
      confidence: item.confidence ?? null,
      allowedChoices: item.allowedChoices,
      mergedEvidence: item.mergedEvidence
        ? {
          prNumber: item.mergedEvidence.prNumber,
          title: item.mergedEvidence.title,
          overlapFiles: item.mergedEvidence.overlapFiles,
        }
        : null,
      duplicateEvidence: item.duplicateEvidence ?? null,
    }));
    const response = await fetch(`${config.qwenEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 240,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ rows }) },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`completion endpoint HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    try {
      return { model, ...validateJanitorChoices(extractJson(content), candidates) };
    } catch (error) {
      log('janitor-qwen-invalid-response', { error: error.message, sample: compactText(content, 500) });
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

function modelChoiceFor(qwen, prNumber) {
  return qwen.choices?.find((item) => item.prNumber === prNumber) ?? null;
}

function janitorChoiceFor(janitor, prNumber) {
  return janitor?.qwen?.choices?.find((item) => item.prNumber === prNumber) ?? null;
}

function actionKey(action) {
  return [action.type, action.prNumber ?? 'none', action.headSha ?? 'none', action.role ?? 'none'].join(':');
}

function actionAllowed(state, action, config) {
  const entry = state.actionLedger?.[actionKey(action)];
  if (!entry) return true;
  if (entry.status === 'success') return false;
  if ((entry.attempts ?? 0) >= config.maximumActionAttempts) return false;
  const last = Date.parse(entry.lastAttemptAt ?? '') || 0;
  return Date.now() - last >= config.actionRetrySeconds * 1000;
}

function mainCi(remote, config) {
  return ciForPull({ checks: remote.mainChecks }, config.requiredCheckName);
}

function planActions(config, remote, decisions, state) {
  const queue = [];
  if (config.mode !== 'guarded' || config.writeActionsEnabled !== true || remote.auth !== 'authenticated') return queue;

  for (const pending of Object.values(state.pendingMerges ?? {})) {
    if (pending.closureCreated || pending.isClosure || config.coordinationCommitsEnabled !== true) continue;
    const ci = mainCi(remote, config);
    if (remote.mainSha === pending.mergeSha && ci.status === 'pass') {
      queue.push({
        type: 'CREATE_CLOSEOUT',
        prNumber: pending.prNumber,
        headSha: pending.mergeSha,
        taskId: pending.taskId,
        mergeSha: pending.mergeSha,
        priority: 100,
      });
    }
  }

  for (const decision of decisions) {
    const pr = remote.pulls.find((item) => item.number === decision.prNumber);
    if (!pr) continue;
    if (decision.mergeEligible && config.autoMergeEnabled === true) {
      queue.push({
        type: 'MERGE',
        prNumber: pr.number,
        headSha: pr.headSha,
        taskId: decision.taskId,
        isClosure: decision.syntheticClosure,
        priority: 90,
      });
      continue;
    }
    if (decision.readyEligible && config.autoReadyEnabled === true) {
      queue.push({
        type: 'MARK_READY',
        prNumber: pr.number,
        headSha: pr.headSha,
        taskId: decision.taskId,
        priority: 70,
      });
      continue;
    }
  }

  return queue
    .filter((action) => automaticActionAllowed(config, action.type))
    .filter((action) => actionAllowed(state, action, config))
    .sort((left, right) => right.priority - left.priority || left.prNumber - right.prNumber)
    .slice(0, config.maxActionsPerRun);
}

function updateTaskForCloseout(remote, pending, config) {
  const binding = canonicalTaskBinding(remote.tasks, remote.pulls, pending.prNumber);
  const task = binding.task;
  if (!task || task.id !== pending.taskId) {
    throw new Error(`Closeout task ${pending.taskId} binding invalid on current main: ${binding.reason ?? 'TASK_ID_MISMATCH'}`);
  }
  if (task.status !== 'İncelemede' && task.status !== "Main'de / kabul açık") {
    throw new Error(`Closeout refused for task status ${task.status}`);
  }
  const matches = remote.taskSource.split(/\r?\n/).filter((line) => line === task.rawLine).length;
  if (matches !== 1) throw new Error('Closeout task row is not uniquely identifiable');
  const evidence = `coordinator merge [PR #${pending.prNumber}](https://github.com/${config.repoSlug}/pull/${pending.prNumber}) main \`${pending.mergeSha}\` · post-main ${config.requiredCheckName} SUCCESS`;
  let nextLine = task.rawLine.replace(`| ${task.status} |`, '| Tamamlandı |');
  if (!nextLine.includes(evidence)) nextLine = nextLine.replace(/\s*\|\s*$/, ` · ${evidence} |`);
  if (nextLine === task.rawLine) throw new Error('Closeout row transformation produced no change');
  return remote.taskSource.replace(task.rawLine, nextLine);
}

async function createCloseoutPull(config, token, remote, pending) {
  if (remote.available !== true || remote.complete !== true) {
    throw new Error('Closeout requires a complete fresh GitHub snapshot');
  }
  if (!remote.taskBlobOid) throw new Error('TASKS.md blob identity unavailable');
  const updatedTasks = updateTaskForCloseout(remote, pending, config);
  const branch = `qwen-coordinator/close-${pending.taskId.toLowerCase()}-${pending.mergeSha.slice(0, 8)}`;
  const baseUrl = `https://api.github.com/repos/${config.repoSlug}`;
  await githubJson(`${baseUrl}/git/refs`, token, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: remote.mainSha },
  });
  await githubJson(`${baseUrl}/contents/TASKS.md`, token, {
    method: 'PUT',
    body: {
      message: `docs(tasks): close ${pending.taskId} after merge`,
      content: Buffer.from(updatedTasks, 'utf8').toString('base64'),
      sha: remote.taskBlobOid,
      branch,
    },
  });
  const pull = await githubJson(`${baseUrl}/pulls`, token, {
    method: 'POST',
    body: {
      title: `docs(tasks): close ${pending.taskId} after merge`,
      head: branch,
      base: config.defaultBranch,
      draft: false,
      body: [
        '<!-- qwen-local-coordinator:closeout -->',
        `Deterministic coordinator closeout for ${pending.taskId} after PR #${pending.prNumber}.`,
        '',
        `- merge SHA: \`${pending.mergeSha}\``,
        `- exact post-main ${config.requiredCheckName}: SUCCESS`,
        '- change surface: `TASKS.md` only',
        '',
        'No product/runtime behavior is changed.',
      ].join('\n'),
    },
  });
  return { number: pull.data.number, url: pull.data.html_url, branch };
}

async function executeAction(config, state, action) {
  const key = actionKey(action);
  state.actionLedger ??= {};
  const ledger = state.actionLedger[key] ?? { attempts: 0 };
  ledger.attempts += 1;
  ledger.lastAttemptAt = nowIso();
  ledger.status = 'running';
  state.actionLedger[key] = ledger;
  writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const token = getGithubToken();
  const fresh = await fetchSnapshot(config, token);
  const decisions = attachDepotEvidence(buildDecisions(config, fresh, state), state);
  const decision = decisions.find((item) => item.prNumber === action.prNumber);

  let result;
  if (action.type === 'CREATE_CLOSEOUT') {
    const pending = state.pendingMerges?.[String(action.prNumber)];
    if (!pending || pending.mergeSha !== action.mergeSha) throw new Error('Pending merge identity changed');
    if (fresh.available !== true || fresh.complete !== true) {
      throw new Error('Closeout requires a complete fresh GitHub snapshot');
    }
    if (fresh.mainSha !== action.mergeSha || mainCi(fresh, config).status !== 'pass') {
      throw new Error('Post-main exact merge SHA/CI gate changed before closeout commit');
    }
    const created = await createCloseoutPull(config, token, fresh, pending);
    state.closurePulls ??= {};
    state.closurePulls[String(created.number)] = {
      taskId: pending.taskId,
      sourcePr: pending.prNumber,
      sourceMergeSha: pending.mergeSha,
      createdAt: nowIso(),
      url: created.url,
      branch: created.branch,
    };
    pending.closureCreated = true;
    pending.closurePullNumber = created.number;
    result = created;
  } else {
    const pr = fresh.pulls.find((item) => item.number === action.prNumber);
    if (!pr || !decision) throw new Error('PR no longer open at action time');
    if (pr.headSha !== action.headSha) throw new Error('PR head changed before action');
    if (action.type === 'MARK_READY') {
      if (!decision.readyEligible) throw new Error('Ready gates no longer satisfied');
      const mutation = `mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number isDraft headRefOid}}}`;
      const response = await githubJson('https://api.github.com/graphql', token, {
        method: 'POST',
        body: { query: mutation, variables: { id: pr.nodeId } },
      });
      if (response.data?.errors?.length) throw new Error(response.data.errors.map((item) => item.message).join('; '));
      result = { ready: true, prNumber: pr.number, headSha: pr.headSha };
    } else if (action.type === 'MERGE') {
      if (!decision.mergeEligible) throw new Error('Merge gates no longer satisfied');
      const response = await githubJson(`https://api.github.com/repos/${config.repoSlug}/pulls/${pr.number}/merge`, token, {
        method: 'PUT',
        body: { sha: pr.headSha, merge_method: config.mergeMethod },
      });
      if (response.data?.merged !== true || !response.data?.sha) {
        throw new Error(`GitHub refused merge: ${response.data?.message ?? 'unknown response'}`);
      }
      state.pendingMerges ??= {};
      state.pendingMerges[String(pr.number)] = {
        prNumber: pr.number,
        taskId: decision.taskId,
        headSha: pr.headSha,
        mergeSha: response.data.sha,
        mergedAt: nowIso(),
        isClosure: action.isClosure === true,
      };
      result = { merged: true, mergeSha: response.data.sha };
    } else {
      throw new Error(`Unknown action type ${action.type}`);
    }
  }

  ledger.status = 'success';
  ledger.completedAt = nowIso();
  ledger.result = result;
  log('action-success', { key, action, result });
  return result;
}

function compactRemoteForReport(remote, config) {
  return {
    available: remote.available,
    complete: remote.complete,
    auth: remote.auth,
    fetchedAt: remote.fetchedAt,
    refreshed: remote.refreshed,
    rateLimitRemaining: remote.rateLimitRemaining ?? null,
    rateLimitCost: remote.rateLimitCost ?? null,
    mainBranch: remote.mainBranch ?? null,
    mainSha: remote.mainSha ?? null,
    mainCi: remote.mainChecks ? mainCi(remote, config).status : 'unknown',
    tasksCount: remote.tasks?.length ?? 0,
    tasksTruncated: remote.tasksTruncated === true,
    coordinationCommentsTruncated: remote.coordinationCommentsTruncated === true,
    recentMergedPullsCount: remote.recentMergedPulls?.length ?? 0,
    pulls: (remote.pulls ?? []).map((pr) => ({
      number: pr.number,
      title: pr.title,
      draft: pr.draft,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      mergeable: pr.mergeable,
      mergeStateStatus: pr.mergeStateStatus,
      fileCount: pr.fileCount,
      reviewsTruncated: pr.reviewsTruncated,
      commentsTruncated: pr.commentsTruncated,
      checksTruncated: pr.checksTruncated,
      unresolvedThreads: pr.unresolvedThreads,
      url: pr.url,
    })),
    errors: remote.errors ?? [],
  };
}

function markdownReport(report) {
  const qwenStatus = report.qwen.status === 'not-run'
    ? '— bu SHA/durum için çağrılmadı'
    : report.qwen.available ? report.qwen.model : 'UNAVAILABLE';
  const lines = [
    '# Qwen Koordinatör — son durum',
    '',
    `- Gözlem: ${report.observedAt}`,
    `- Mod: **${report.mode.toUpperCase()}**`,
    `- GitHub main: \`${report.remote.mainSha?.slice(0, 12) ?? 'unknown'}\``,
    `- GitHub erişimi: ${report.remote.available ? 'tam' : 'eksik'} · rate limit ${report.remote.rateLimitRemaining ?? '?'}`,
    `- Depot shadow CI: ${report.depot.enabled ? `açık · aktif ${report.depot.active}` : 'kapalı'}`,
    `- Qwen: ${qwenStatus}`,
    `- Otomatik aksiyon: ${report.executedAction ? `${report.executedAction.type} / PR #${report.executedAction.prNumber}` : 'yok'}`,
    '',
    '## PR kararları',
    '',
    '| PR | Görev | Politika | Qwen | GitHub CI | Depot | Engel / sonraki adım |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const decision of report.decisions) {
    const model = modelChoiceFor(report.qwen, decision.prNumber);
    const qwenChoice = model ? `${model.choice} ${model.label}${model.overriddenByPolicy ? ' (sınırlandı)' : ''}` : '—';
    lines.push(`| [#${decision.prNumber}](${decision.url}) | ${decision.taskId ?? 'eşleşmedi'} | **${decision.choice} ${decision.label}** | ${qwenChoice} | ${decision.ci.status} | ${decision.depot.status} | ${decision.reason.replaceAll('|', '\\|')} |`);
  }
  if (report.decisions.length === 0) lines.push('| — | — | A WAIT | — | — | — | Açık PR yok. |');
  lines.push('', '## Repo hijyeni', '');
  const janitorStatus = report.janitor.qwen.status === 'not-run'
    ? 'Qwen çağrılmadı'
    : report.janitor.qwen.available ? report.janitor.qwen.model : 'Qwen unavailable';
  lines.push(`- Janitor: ${report.janitor.enabled ? 'açık' : 'kapalı'} · ${report.janitor.candidates.length} aday · ${janitorStatus}`);
  if (report.janitor.candidates.length > 0) {
    lines.push('', '| PR | Sinyal | Güven | Qwen | Kanıt |', '| --- | --- | --- | --- | --- |');
    for (const item of report.janitor.candidates) {
      const advice = janitorChoiceFor(report.janitor, item.prNumber);
      const qwenAdvice = advice ? advice.choice : '—';
      const evidence = item.mergedEvidence
        ? `merged #${item.mergedEvidence.prNumber}: ${item.mergedEvidence.overlapFiles.join(', ')}`
        : item.duplicateEvidence
          ? `open #${item.duplicateEvidence.prNumber}`
          : item.reason;
      lines.push(`| [#${item.prNumber}](${item.url}) | ${item.status} | ${item.confidence ?? '—'} | ${qwenAdvice} | ${String(evidence).replaceAll('|', '\\|')} |`);
    }
  } else {
    lines.push('- Temizlenecek veya kapasite uyarısı gerektiren aday yok.');
  }
  lines.push('', '## Aksiyon kuyruğu', '');
  if (report.actionQueue.length === 0) lines.push('- Uygulanabilir, tüm kapıları geçmiş aksiyon yok.');
  for (const action of report.actionQueue) {
    lines.push(`- ${action.type} · PR #${action.prNumber}${action.role ? ` · ${action.role}` : ''} · \`${action.headSha?.slice(0, 12) ?? '—'}\``);
  }
  lines.push('', '## Güvenlik sınırı', '');
  lines.push('- Qwen kararı danışmadır; deterministik kapıyı yükseltemez.');
  lines.push('- Janitor yalnız rapor/advisory üretir; PR kapatma veya rebase yetkisi yoktur.');
  lines.push('- Qwen yalnız exact-head GitHub CI ve Depot shadow CI başarıyla bittikten sonra karar-değer kod PR’larında çağrılır.');
  lines.push('- Depot sonucu shadow kanıttır; GitHub `CI gate` yerine geçmez.');
  lines.push('- Merge öncesi GitHub head/base/CI/review/thread kanıtı yeniden okunur.');
  lines.push('- Bir turda en fazla bir dış aksiyon; her aksiyon PR + exact SHA ile tekilleştirilir.');
  lines.push('- Secret, deploy, migration yazımı ve proje kodu değişikliği bu daemon tarafından yapılmaz.');
  lines.push('', '> TASKS.md tek canlı görev otoritesidir; bu rapor geçici gözlemdir.', '');
  return lines.join('\n');
}

function notifyIfNeeded(state, report) {
  state.notificationLedger ??= {};
  const { ledger } = dispatchNotificationEvents(report, state.notificationLedger, (event) => {
    command('/usr/bin/osascript', ['-e', `display notification "${event.message}" with title "Qwen Koordinatör"`], { timeout: 5_000 });
    return true;
  }, nowIso);
  state.notificationLedger = ledger;
}

function observationFingerprint(config, remote, decisions) {
  return policyFingerprint({
    qwenPromptVersion: config.qwenPromptVersion,
    mainSha: remote.mainSha,
    tasks: remote.tasks?.map(({ id, status, owner, prNumbers, evidence }) => ({
      id, status, owner, prNumbers, evidence,
    })),
    pulls: decisions.map(({
      prNumber, headSha, baseSha, draft, choice, ci, depot, missingReviews, gaps,
    }) => ({
      prNumber,
      headSha,
      baseSha,
      draft,
      choice,
      ci: ci.status,
      depot: depot.status,
      missingReviews,
      gaps,
    })),
  });
}

async function main() {
  if (!acquireLock()) {
    log('skip-overlap');
    return;
  }
  try {
    const config = readJson(configFile, null);
    if (!config) throw new Error('config.json okunamadı');
    const state = readJson(stateFile, {});
    state.actionLedger ??= {};
    state.pendingMerges ??= {};
    state.closurePulls ??= {};
    state.depotRuns ??= {};
    const local = gatherLocal(config);
    let remote = await gatherRemote(config, state);
    let decisions = buildDecisions(config, remote, state);
    await reconcileDepot(config, remote, decisions, state);
    decisions = attachDepotEvidence(decisions, state);
    let fingerprint = observationFingerprint(config, remote, decisions);

    const qwenCandidates = qwenEligibleDecisions(decisions);
    const qwenFingerprint = policyFingerprint({
      qwenPromptVersion: config.qwenPromptVersion,
      candidates: qwenCandidates.map(({
        prNumber, headSha, baseSha, choice, ci, depot, mergeable, draft, missingReviews, gaps,
      }) => ({
        prNumber,
        headSha,
        baseSha,
        choice,
        ci: ci.status,
        depot: depot.status,
        mergeable,
        draft,
        missingReviews,
        gaps,
      })),
    });
    const lastAttemptMs = Date.parse(state.lastQwenAttemptAt ?? '') || 0;
    const shouldAskQwen = qwenCandidates.length > 0
      && Date.now() - lastAttemptMs >= config.qwenRetrySeconds * 1000
      && qwenFingerprint !== state.lastQwenFingerprint;
    let qwen = {
      available: false,
      choices: [],
      summary: qwenCandidates.length === 0
        ? 'Bu SHA/durum için Qwen çağrılmadı; CI terminal ve karar-değer durum bekleniyor.'
        : 'Qwen yeniden değerlendirme aralığını bekliyor.',
      advisoryOnly: true,
      stale: false,
      status: 'not-run',
    };
    if (shouldAskQwen) {
      state.lastQwenAttemptAt = nowIso();
      try {
        qwen = { ...await askQwen(config, qwenCandidates), status: 'complete' };
        state.lastAnalysisAt = nowIso();
        state.lastQwenFingerprint = qwenFingerprint;
        state.lastQwen = qwen;
      } catch (error) {
        qwen = {
          available: false,
          choices: [],
          summary: `Yerel Qwen değerlendirmesi alınamadı: ${error.message}`,
          advisoryOnly: true,
          stale: false,
          status: 'error',
        };
        log('qwen-unavailable', { error: error.message });
      }
    } else if (qwenCandidates.length > 0 && qwenFingerprint === state.lastQwenFingerprint && state.lastQwen) {
      qwen = { ...state.lastQwen, stale: false };
    }

    let actionQueue = planActions(config, remote, decisions, state);
    let executedAction = null;
    if (actionQueue.length > 0) {
      const action = actionQueue[0];
      try {
        const result = await executeAction(config, state, action);
        executedAction = { ...action, result };
        remote = await gatherRemote(config, state, { force: true });
        decisions = attachDepotEvidence(buildDecisions(config, remote, state), state);
        fingerprint = observationFingerprint(config, remote, decisions);
        qwen = {
          available: false,
          choices: [],
          summary: 'Dış aksiyon sonrası yenilenen snapshot için Qwen sonucu yeniden kullanılmadı.',
          advisoryOnly: true,
          stale: false,
          status: 'not-run',
        };
      } catch (error) {
        const key = actionKey(action);
        state.actionLedger[key] ??= { attempts: 1, lastAttemptAt: nowIso() };
        state.actionLedger[key].status = 'failed';
        state.actionLedger[key].error = error.message.slice(0, 1000);
        log('action-failed', { key, action, error: error.message });
      }
      actionQueue = planActions(config, remote, decisions, state);
    }

    const janitorCandidates = buildJanitorCandidates(remote, config);
    const janitorFingerprint = policyFingerprint(janitorFingerprintInput(
      janitorCandidates,
      config.janitorPromptVersion ?? 1,
    ));
    const janitorRetrySeconds = config.janitorRetrySeconds ?? 300;
    const lastJanitorAttemptMs = Date.parse(state.lastJanitorQwenAttemptAt ?? '') || 0;
    const shouldAskJanitor = config.janitorQwenEnabled !== false
      && janitorCandidates.length > 0
      && Date.now() - lastJanitorAttemptMs >= janitorRetrySeconds * 1000
      && janitorFingerprint !== state.lastJanitorQwenFingerprint;
    let janitorQwen = {
      available: false,
      choices: [],
      summary: janitorCandidates.length === 0
        ? 'Repo hygiene candidate yok.'
        : 'Janitor Qwen fingerprint değişimi veya retry penceresi bekliyor.',
      advisoryOnly: true,
      stale: false,
      status: 'not-run',
    };
    if (shouldAskJanitor) {
      state.lastJanitorQwenAttemptAt = nowIso();
      try {
        janitorQwen = { ...await askJanitorQwen(config, janitorCandidates), status: 'complete' };
        state.lastJanitorQwenFingerprint = janitorFingerprint;
        state.lastJanitorQwen = janitorQwen;
      } catch (error) {
        janitorQwen = {
          available: false,
          choices: [],
          summary: `Janitor Qwen değerlendirmesi alınamadı: ${error.message}`,
          advisoryOnly: true,
          stale: false,
          status: 'error',
        };
        log('janitor-qwen-unavailable', { error: error.message });
      }
    } else if (janitorCandidates.length > 0
      && janitorFingerprint === state.lastJanitorQwenFingerprint
      && state.lastJanitorQwen) {
      janitorQwen = { ...state.lastJanitorQwen, stale: false };
    }

    const report = {
      schemaVersion: 3,
      observedAt: nowIso(),
      fingerprint,
      mode: config.mode,
      authoritativeSource: `https://github.com/${config.repoSlug}/blob/${config.defaultBranch}/TASKS.md`,
      disposableObservation: true,
      local,
      remote: compactRemoteForReport(remote, config),
      decisions,
      qwen,
      janitor: {
        enabled: config.janitorEnabled !== false,
        fingerprint: janitorFingerprint,
        candidates: janitorCandidates,
        qwen: janitorQwen,
        writeAuthority: false,
      },
      depot: {
        enabled: config.depotShadowEnabled === true,
        active: Object.values(state.depotRuns).filter((run) => !isDepotTerminal(run.status) && run.status !== 'start-error').length,
        runs: Object.values(state.depotRuns).map((run) => ({
          prNumber: run.prNumber,
          headSha: run.headSha,
          runId: run.runId ?? null,
          status: run.status,
          viewUrl: run.viewUrl ?? null,
          workflowHash: run.workflowHash ?? null,
          commentPublished: run.commentPublished === true,
          error: run.error ?? run.lastPollError ?? run.commentError ?? null,
        })),
      },
      actionQueue,
      executedAction,
      gaps: [...local.errors, ...(remote.errors ?? [])],
    };
    notifyIfNeeded(state, report);
    state.lastFingerprint = fingerprint;
    state.remoteCache = { ...remote, refreshed: false };
    state.lastRunAt = report.observedAt;
    writeAtomic(reportJsonFile, `${JSON.stringify(report, null, 2)}\n`);
    writeAtomic(reportMarkdownFile, `${markdownReport(report)}\n`);
    writeAtomic(actionQueueFile, `${JSON.stringify({ observedAt: report.observedAt, queue: actionQueue }, null, 2)}\n`);
    writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    log('observation-complete', {
      fingerprint,
      openPullRequests: decisions.length,
      choices: Object.fromEntries(Object.keys(CHOICES).map((choice) => [choice, decisions.filter((item) => item.choice === choice).length])),
      qwenAvailable: qwen.available,
      janitorCandidates: janitorCandidates.length,
      janitorQwenAvailable: janitorQwen.available,
      queuedActions: actionQueue.length,
      executedAction: executedAction?.type ?? null,
    });
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  log('fatal', { error: error.stack ?? error.message });
  process.exitCode = 1;
});
