import { createHash, randomUUID } from 'node:crypto';

const SHA = /^[a-f0-9]{40}$/;
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

function text(value) {
  return String(value ?? '');
}

function unique(values) {
  return [...new Set(values)];
}

export function workflowHash(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function parseDepotRunId(output) {
  const raw = text(output).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const direct = parsed?.run_id ?? parsed?.runId ?? parsed?.id;
    if (/^[a-z0-9]{10}$/i.test(text(direct))) return text(direct);
  } catch {
    // Human-readable CLI output is supported below.
  }
  const labelled = raw.match(/(?:run(?:\s+id)?|run_id)\s*[:=]?\s*`?([a-z0-9]{10})\b/i);
  if (labelled) return labelled[1];
  const url = raw.match(/depot\.dev\/[^\s]*?\b([a-z0-9]{10})\b/i);
  if (url) return url[1];
  const ids = raw.match(/\b[a-z0-9]{10}\b/gi) ?? [];
  return unique(ids).length === 1 ? ids[0] : null;
}

export function normalizeDepotStatus(payload) {
  const workflows = Array.isArray(payload?.workflows) ? payload.workflows : [];
  const jobs = workflows.flatMap((workflow) => Array.isArray(workflow.jobs) ? workflow.jobs : []);
  const attempts = jobs.flatMap((job) => Array.isArray(job.attempts) ? job.attempts : []);
  const statuses = [payload?.status, ...workflows.map((item) => item.status),
    ...jobs.map((item) => item.status), ...attempts.map((item) => item.status)]
    .map((value) => text(value).toLowerCase()).filter(Boolean);
  const failedJobs = jobs
    .filter((job) => text(job.status).toLowerCase() === 'failed'
      || (job.attempts ?? []).some((attempt) => text(attempt.status).toLowerCase() === 'failed'))
    .map((job) => job.job_key ?? job.name ?? job.job_id).filter(Boolean);
  const viewUrl = attempts.map((item) => item.view_url).find(Boolean) ?? null;

  let status = 'unknown';
  if (statuses.some((value) => value === 'failed' || value === 'failure')) status = 'fail';
  else if (statuses.some((value) => value === 'cancelled' || value === 'canceled')) status = 'cancelled';
  else if (statuses.some((value) => value === 'running' || value === 'in_progress')) status = 'running';
  else if (statuses.some((value) => value === 'queued' || value === 'pending')) status = 'queued';
  else {
    const completeEvidence = workflows.length > 0
      && workflows.every((workflow) => Array.isArray(workflow.jobs) && workflow.jobs.length > 0
        && text(workflow.status).length > 0
        && workflow.jobs.every((job) => Array.isArray(job.attempts) && job.attempts.length > 0
          && text(job.status).length > 0
          && job.attempts.every((attempt) => text(attempt.status).length > 0)));
    if (completeEvidence
      && statuses.every((value) => value === 'finished' || value === 'success')) status = 'pass';
  }

  return {
    status,
    runId: payload?.run_id ?? null,
    viewUrl,
    failedJobs: unique(failedJobs),
    rawStatus: payload?.status ?? null,
  };
}

export function isDepotTerminal(status) {
  return ['pass', 'fail', 'cancelled', 'superseded', 'identity-error'].includes(status);
}

export function createDepotLaunchReservation(pr, previous = null, reservedAt = new Date().toISOString()) {
  const sameIdentity = previous?.headSha === pr.headSha && previous?.baseSha === pr.baseSha;
  return {
    prNumber: pr.number,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    headRef: pr.headRef,
    status: 'launch-reserved',
    launchReservationId: randomUUID(),
    launchReservedAt: reservedAt,
    startedAt: sameIdentity ? previous.startedAt ?? reservedAt : reservedAt,
    lastStartAttemptAt: reservedAt,
    startAttempts: sameIdentity ? (previous.startAttempts ?? 0) + 1 : 1,
    commentPublished: false,
  };
}

export function depotFetchRef(pr) {
  if (!Number.isSafeInteger(pr?.number) || pr.number < 1
    || !SHA.test(text(pr?.headSha))
    || !SAFE_REF.test(text(pr?.headRef))
    || text(pr?.headRef).includes('..')) {
    throw new Error('Unsafe Depot PR fetch identity');
  }
  return {
    remoteRef: `refs/heads/${pr.headRef}`,
    localRef: `refs/qwen-coordinator/pr-${pr.number}`,
  };
}

export function depotEligible(pr, decision, config) {
  const structuralBlockers = new Set([
    'REMOTE_EVIDENCE_INCOMPLETE',
    'TASK_NOT_MAPPED',
    'FILES_TRUNCATED',
    'THREADS_TRUNCATED',
    'BASE_NOT_CURRENT_MAIN',
    'CROSS_REPOSITORY_HEAD',
  ]);
  const githubAwaiting = ['missing', 'pending'].includes(decision.ci?.status);
  const githubPassed = decision.ci?.status === 'pass';
  return config.depotShadowEnabled === true
    && decision?.taskId
    && decision.choice !== 'B'
    && !(decision.gaps ?? []).some((gap) => structuralBlockers.has(gap))
    && decision.syntheticClosure !== true
    && decision.surface?.docsOnly === false
    && decision.surface?.incomplete === false
    && pr?.fromFork !== true
    && SHA.test(text(pr?.headSha))
    && SHA.test(text(pr?.baseSha))
    && SAFE_REF.test(text(pr?.headRef))
    && !text(pr?.headRef).includes('..')
    && (githubAwaiting || githubPassed);
}

export function applyDepotEvidence(decision, run) {
  const depot = !run || run.headSha !== decision.headSha || run.baseSha !== decision.baseSha
    ? { status: decision.surface?.docsOnly ? 'skipped-docs' : 'not-run' }
    : {
      status: run.status,
      runId: run.runId ?? null,
      url: run.viewUrl ?? null,
      workflowHash: run.workflowHash ?? null,
      failedJobs: run.failedJobs ?? [],
    };
  const next = { ...decision, depot };
  if (depot.status === 'not-run' && decision.surface?.docsOnly === false
    && decision.ci?.status === 'pass') {
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: 'GitHub CI geçti ancak aynı head/base kimliği için Depot shadow CI kanıtı yok.',
      gaps: unique([...(decision.gaps ?? []), 'DEPOT_SHADOW_MISSING']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (depot.status === 'identity-error') {
    if (decision.choice === 'B') {
      return { ...next, gaps: unique([...(decision.gaps ?? []), 'DEPOT_IDENTITY_UNVERIFIED']) };
    }
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: 'Depot koşusunun gözlenen commit kimliği exact PR head ile eşleşmiyor; kanıt geçersiz.',
      gaps: unique([...(decision.gaps ?? []), 'DEPOT_IDENTITY_UNVERIFIED']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (['queued', 'running'].includes(depot.status) && decision.ci.status === 'pass') {
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: 'GitHub CI geçti; aynı exact head için başlayan Depot shadow CI sonucu bekleniyor.',
      gaps: unique([...(decision.gaps ?? []), 'DEPOT_SHADOW_PENDING']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (depot.status === 'fail' && decision.ci.status === 'pass') {
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: 'GitHub CI ile Depot shadow CI çelişiyor; insan incelemesi gerekiyor.',
      gaps: unique([...(decision.gaps ?? []), 'CI_EVIDENCE_CONFLICT']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (depot.status === 'pass' && decision.ci.status === 'fail') {
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: 'GitHub CI başarısızken Depot shadow CI geçti; asıl kapı onarılmadan ilerlenemez.',
      gaps: unique([...(decision.gaps ?? []), 'CI_EVIDENCE_CONFLICT']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (depot.status === 'fail' && ['missing', 'pending'].includes(decision.ci.status)) {
    return {
      ...next,
      choice: 'B',
      label: 'REPAIR',
      reason: 'Exact-head Depot shadow CI erken hata verdi; GitHub CI sürerken dar onarım adayı oluştu.',
      gaps: unique([...(decision.gaps ?? []), 'DEPOT_SHADOW_FAILED']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  if (decision.surface?.docsOnly === false && depot.status !== 'pass'
    && decision.ci?.status === 'pass') {
    if (decision.choice === 'B') {
      return {
        ...next,
        gaps: unique([...(decision.gaps ?? []), 'DEPOT_SHADOW_UNAVAILABLE']),
        readyEligible: false,
        mergeEligible: false,
      };
    }
    return {
      ...next,
      choice: 'A',
      label: 'WAIT',
      reason: `Depot shadow CI durumu merge kanıtı değil: ${depot.status}.`,
      gaps: unique([...(decision.gaps ?? []), 'DEPOT_SHADOW_UNAVAILABLE']),
      readyEligible: false,
      mergeEligible: false,
    };
  }
  return next;
}

export function qwenEligibleDecisions(decisions) {
  return decisions.filter((decision) => decision.surface?.docsOnly === false
    && decision.ci?.status === 'pass'
    && decision.depot?.status === 'pass'
    && !decision.gaps?.includes('CI_EVIDENCE_CONFLICT')
    && (decision.choice === 'C' || decision.choice === 'D'));
}

export function depotCommentBody(run, workflowName) {
  const status = run.status === 'pass' ? 'PASS'
    : run.status === 'fail' ? 'FAIL'
      : run.status === 'identity-error' ? 'INVALID IDENTITY'
        : run.status.toUpperCase();
  const runLine = run.viewUrl
    ? `[\`${run.runId}\`](${run.viewUrl})`
    : `\`${run.runId}\``;
  const failed = run.failedJobs?.length ? run.failedJobs.map((item) => `\`${item}\``).join(', ') : '—';
  return [
    '<!-- qwen-local-coordinator:depot-shadow-ci -->',
    `## Depot shadow CI — ${status}`,
    '',
    `- Exact head: \`${run.headSha}\``,
    `- Base SHA: \`${run.baseSha}\``,
    `- Tree SHA: \`${run.treeSha ?? 'unavailable'}\``,
    `- Observed Depot SHA: \`${run.observedSha ?? run.observedHeadSha ?? 'unavailable'}\``,
    `- Run: ${runLine}`,
    `- Workflow: \`${workflowName}\` · SHA-256 \`${run.workflowHash}\``,
    `- Failed jobs: ${failed}`,
    '',
    '> Shadow evidence only. This run does not replace the required GitHub `CI gate` and cannot authorize review acceptance or merge.',
  ].join('\n');
}
