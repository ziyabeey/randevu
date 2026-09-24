import { createHash } from 'node:crypto';

export const CHOICES = Object.freeze({
  A: 'WAIT',
  B: 'REPAIR',
  C: 'REVIEW',
  D: 'MERGE',
});

const ACTION_CAPABILITIES = Object.freeze({
  RUN_DEPOT: 'run_exact_sha_depot_shadow_ci',
  UPDATE_DEPOT_COMMENT: 'update_single_depot_evidence_comment',
  MARK_READY: 'mark_review_ready_after_hard_gates',
  MERGE: 'merge_after_all_hard_gates',
  CREATE_CLOSEOUT: 'create_tasks_closeout_commit_after_post_main_ci',
});

const TASK_STATUSES = [
  'Tamamlandı',
  "Main'de / kabul açık",
  'İncelemede',
  'Çalışılıyor',
  'Üstlenildi',
  'Engelli',
  'Planlandı',
];

const SHA = /^[a-f0-9]{40}$/;
const INDEPENDENT_ROLES = ['R1', 'R2'];
const GENERIC_REVIEW_BOTS = new Set([
  'copilot-pull-request-reviewer',
  'copilot-pull-request-reviewer[bot]',
  'chatgpt-codex-connector',
  'chatgpt-codex-connector[bot]',
]);

function text(value) {
  return String(value ?? '');
}

function lower(value) {
  return text(value).toLocaleLowerCase('tr-TR');
}

function unique(values) {
  return [...new Set(values)];
}

export function validateQwenChoices(value, decisions) {
  const known = new Map(decisions.map((decision) => [decision.prNumber, decision]));
  const choices = [];
  const seen = new Set();
  let submitted;
  if (Array.isArray(value?.choices)) {
    if (!value.choices.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      throw new Error('Qwen choices must carry explicit prNumber values');
    }
    submitted = value.choices;
  } else if (value?.choices && typeof value.choices === 'object') {
    submitted = Object.entries(value.choices).map(([prNumber, choice]) => {
      if (!/^[1-9][0-9]*$/.test(prNumber)) {
        throw new Error(`Qwen returned an invalid PR key: ${prNumber}`);
      }
      return { prNumber: Number(prNumber), choice };
    });
  } else {
    throw new Error('Qwen response does not contain keyed choices');
  }
  for (const item of submitted) {
    const prNumber = item?.prNumber;
    const choice = String(item?.choice ?? '').toUpperCase();
    if (!Number.isSafeInteger(prNumber) || !known.has(prNumber) || !Object.hasOwn(CHOICES, choice)) {
      throw new Error(`Qwen returned an unknown PR/choice pair: ${prNumber}/${choice}`);
    }
    if (seen.has(prNumber)) throw new Error(`Qwen returned duplicate choice coverage for PR #${prNumber}`);
    seen.add(prNumber);
    choices.push({
      prNumber,
      choice,
      label: CHOICES[choice],
      overriddenByPolicy: known.get(prNumber).choice !== choice,
    });
  }
  if (choices.length !== decisions.length || seen.size !== known.size) {
    throw new Error(`Qwen returned ${choices.length}/${decisions.length} choices`);
  }
  return {
    available: true,
    choices,
    summary: `${choices.length} PR sabit A/B/C/D seçenekleriyle değerlendirildi.`,
    advisoryOnly: true,
    stale: false,
  };
}

export function automaticActionAllowed(config, actionType) {
  const capability = ACTION_CAPABILITIES[actionType];
  return Boolean(capability)
    && Array.isArray(config?.allowedAutomaticActions)
    && config.allowedAutomaticActions.includes(capability);
}

export function githubPollIntervalSeconds(previousState, config) {
  const previous = previousState?.remoteCache ?? null;
  const trackedPulls = new Set(
    (previous?.tasks ?? []).flatMap((task) => Array.isArray(task.prNumbers) ? task.prNumbers : []),
  );
  const trackedCiActive = (previous?.pulls ?? []).some((pr) => trackedPulls.has(pr.number)
    && (pr.checks ?? []).some((check) => check.name === config.requiredCheckName
      && check.status !== 'COMPLETED'));
  const depotActive = Object.values(previousState?.depotRuns ?? {})
    .some((run) => run && !['pass', 'fail', 'cancelled', 'superseded', 'identity-error', 'start-error']
      .includes(run.status));
  let seconds = trackedCiActive || depotActive
    ? (config.githubActivePollSeconds ?? 30)
    : (config.githubAuthenticatedPollSeconds ?? 60);

  const remaining = previous?.rateLimitRemaining;
  if (remaining !== null && remaining !== undefined && Number.isFinite(Number(remaining))) {
    const numeric = Number(remaining);
    if (numeric <= (config.githubCriticalRateLimitThreshold ?? 250)) {
      seconds = Math.max(seconds, config.githubCriticalRateLimitPollSeconds ?? 900);
    } else if (numeric <= (config.githubLowRateLimitThreshold ?? 1000)) {
      seconds = Math.max(seconds, config.githubLowRateLimitPollSeconds ?? 300);
    }
  }
  return Math.max(15, seconds);
}

export function safeDepotMaxConcurrentRuns(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function depotRunHardInvalidation(decision) {
  const gaps = Array.isArray(decision?.gaps) ? decision.gaps : [];
  return decision?.choice === 'B' || gaps.some((gap) => [
    'TASK_NOT_MAPPED',
    'BASE_NOT_CURRENT_MAIN',
    'STACK_BASE_NOT_DECLARED',
    'STACK_PARENT_HEAD_STALE',
    'CROSS_REPOSITORY_HEAD',
  ].includes(gap));
}

// Small local models copy a concrete example verbatim (e.g. answering only the
// sample PR), so the prompt lists the exact keys expected instead of an example.
export function qwenSystemPrompt(decisions) {
  const keys = (decisions ?? []).map((decision) => decision.prNumber);
  return [
    'PR sınıflandır. A=WAIT, B=REPAIR, C=REVIEW, D=MERGE.',
    'Her kaydın policy alanı deterministik üst sınırdır; daha ileri karar verme.',
    'CI fail veya conflict B; kanıt/base/task eksik A; review eksik C; D yalnız üst sınır D ise.',
    `Her satır için tam bir karar ver; toplam ${keys.length} anahtar: ${keys.join(', ')}.`,
    'Yalnız JSON döndür: {"choices":{"<prNumber>":"<A|B|C|D>"}}.',
  ].join(' ');
}

export function notificationEvents(report) {
  const action = report?.executedAction;
  if (action) {
    return [{
      key: ['action', action.type, action.prNumber ?? 'none', action.headSha ?? 'none', action.role ?? 'none'].join(':'),
      message: `PR #${action.prNumber}: ${action.type} tamamlandı.`,
    }];
  }
  return (report?.decisions ?? []).filter((item) => item.choice === 'B' || item.choice === 'D').map((urgent) => ({
    key: ['decision', urgent.prNumber, urgent.headSha ?? 'none', urgent.choice].join(':'),
    message: `PR #${urgent.prNumber}: ${urgent.label} gerekiyor.`,
  }));
}

export function notificationEvent(report) {
  return notificationEvents(report)[0] ?? null;
}

export function dispatchNotificationEvents(report, ledger, deliver, deliveredAt = () => new Date().toISOString()) {
  const next = { ...(ledger ?? {}) };
  const delivered = [];
  for (const event of notificationEvents(report)) {
    if (next[event.key]) continue;
    let succeeded = false;
    try {
      succeeded = deliver(event) === true;
    } catch {
      succeeded = false;
    }
    if (!succeeded) continue;
    next[event.key] = deliveredAt();
    delivered.push(event);
  }
  const entries = Object.entries(next)
    .sort((left, right) => String(right[1]).localeCompare(String(left[1])))
    .slice(0, 200);
  return { ledger: Object.fromEntries(entries), delivered };
}

export function parseTasksSnapshot(source, maxRows = 200) {
  const rows = [];
  let totalRows = 0;
  for (const line of text(source).split(/\r?\n/)) {
    if (!/^\|\s*(?:\[[A-Z][A-Z0-9-]*\](?:\([^)]*\))?|[A-Z][A-Z0-9-]*)\s*\|/.test(line)) continue;
    const columns = line.split('|').slice(1, -1).map((value) => value.trim());
    const id = columns[0]?.match(/^\[([^\]]+)\]/)?.[1]
      ?? columns[0]?.match(/^([A-Z][A-Z0-9-]*)$/)?.[1]
      ?? null;
    const statusIndex = columns.findIndex((value) => TASK_STATUSES.includes(value));
    if (!id || statusIndex < 0) continue;
    totalRows += 1;
    if (rows.length >= maxRows) continue;
    const status = columns[statusIndex];
    const owner = columns[statusIndex + 1] ?? null;
    const evidence = columns.slice(statusIndex + 2).join(' | ');
    const prNumbers = unique(
      [...evidence.matchAll(/PR\s+#(\d+)/gi)].map((match) => Number(match[1])),
    );
    rows.push({
      id,
      title: columns[1] ?? null,
      dependencies: columns.slice(2, statusIndex).join(' | '),
      status,
      owner,
      prNumbers,
      evidence,
      rawLine: line,
    });
  }
  return { rows, totalRows, truncated: totalRows > rows.length };
}

export function parseTasksText(source, maxRows = 200) {
  return parseTasksSnapshot(source, maxRows).rows;
}

export function receiptEvidenceBody(value) {
  return String(value ?? '');
}

export function compactReviewEvidence(node) {
  return {
    id: node?.databaseId ?? null,
    author: node?.author?.login ?? null,
    state: node?.state ?? null,
    commitOid: node?.commit?.oid ?? null,
    body: receiptEvidenceBody(node?.body),
    submittedAt: node?.submittedAt ?? null,
    updatedAt: node?.updatedAt ?? null,
    url: node?.url ?? null,
  };
}

export function canonicalTaskBinding(tasks, pulls, prNumber) {
  const matchingTasks = (tasks ?? []).filter((task) => task.prNumbers?.includes(prNumber));
  if (matchingTasks.length !== 1) {
    return {
      task: null,
      reason: matchingTasks.length === 0 ? 'TASK_NOT_MAPPED' : 'TASK_BINDING_AMBIGUOUS',
    };
  }
  const openPullNumbers = new Set((pulls ?? []).map((pull) => pull.number));
  const competingOpenPulls = matchingTasks[0].prNumbers
    .filter((number) => number !== prNumber && openPullNumbers.has(number));
  if (competingOpenPulls.length > 0) {
    return {
      task: null,
      reason: 'TASK_ROW_SHARED_BY_OPEN_PULLS',
    };
  }
  return { task: matchingTasks[0], reason: null };
}
function escapedPattern(value) {
  return text(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}
function taskDependsOn(task, dependencyId) {
  if (!task || !dependencyId) return false;
  const source = text(task.dependencies);
  return new RegExp(`(?:^|[^A-Z0-9-])${escapedPattern(dependencyId)}(?:$|[^A-Z0-9-])`, 'i').test(source);
}

export function canonicalPullBaseRelation(pr, context = {}) {
  const {
    mainSha,
    mainBranch = 'main',
    task,
    tasks = [],
    pulls = [],
  } = context;
  const directMain = !pr?.baseRef || pr.baseRef === mainBranch;
  if (directMain) {
    const current = Boolean(mainSha) && pr?.baseSha === mainSha;
    return {
      kind: 'main',
      current,
      mergeTargetCurrent: current,
      gap: current ? null : 'BASE_NOT_CURRENT_MAIN',
      parentPrNumber: null,
      parentTaskId: null,
    };
  }

  const parent = pulls.find((candidate) => candidate?.number !== pr?.number
    && candidate?.headRef === pr?.baseRef) ?? null;
  if (!parent) {
    return {
      kind: 'unknown',
      current: false,
      mergeTargetCurrent: false,
      gap: 'BASE_NOT_CURRENT_MAIN',
      parentPrNumber: null,
      parentTaskId: null,
    };
  }

  const parentBinding = canonicalTaskBinding(tasks, pulls, parent.number);
  if (!task || !parentBinding.task || !taskDependsOn(task, parentBinding.task.id)) {
    return {
      kind: 'stack-invalid',
      current: false,
      mergeTargetCurrent: false,
      gap: 'STACK_BASE_NOT_DECLARED',
      parentPrNumber: parent.number,
      parentTaskId: parentBinding.task?.id ?? null,
    };
  }

  const current = Boolean(parent.headSha) && pr?.baseSha === parent.headSha;
  return {
    kind: 'stack',
    current,
    mergeTargetCurrent: false,
    gap: current ? 'STACK_DEPENDENCY_PENDING' : 'STACK_PARENT_HEAD_STALE',
    parentPrNumber: parent.number,
    parentTaskId: parentBinding.task.id,
  };
}

export function ciForPull(pr, requiredName = 'CI gate') {
  const checks = Array.isArray(pr.checks) ? pr.checks : [];
  const candidates = checks
    .filter((check) => check.type === 'CheckRun' && text(check.name).toLowerCase() === requiredName.toLowerCase())
    .sort((left, right) => text(right.completedAt ?? right.startedAt).localeCompare(text(left.completedAt ?? left.startedAt)));
  const check = candidates[0] ?? null;
  if (!check) return { status: 'missing', check: null, exactHead: false };
  const status = text(check.status).toUpperCase();
  const conclusion = text(check.conclusion).toUpperCase();
  if (status !== 'COMPLETED') return { status: 'pending', check, exactHead: true };
  return {
    status: conclusion === 'SUCCESS' ? 'pass' : 'fail',
    check,
    exactHead: true,
  };
}

export function changedSurface(pr, config) {
  const files = Array.isArray(pr.files) ? pr.files : [];
  const paths = files.map((file) => text(file.path));
  const docsOnlyPatterns = (config.docsOnlyPatterns ?? []).map(lower);
  const r1Patterns = (config.r1PathPatterns ?? []).map(lower);
  const r2Patterns = (config.r2PathPatterns ?? []).map(lower);
  const normalized = paths.map(lower);
  const renameEvidenceIncomplete = files.some((file) => text(file.changeType).toUpperCase() === 'RENAMED');
  const countIncomplete = Number.isInteger(pr.fileCount) && pr.fileCount !== files.length;
  const docsOnly = paths.length > 0 && normalized.every((file) => docsOnlyPatterns.some((pattern) => file.startsWith(pattern) || file.endsWith(pattern)));
  return {
    paths,
    docsOnly,
    r1ByPath: normalized.some((file) => r1Patterns.some((pattern) => file.includes(pattern))),
    r2ByPath: normalized.some((file) => r2Patterns.some((pattern) => file.includes(pattern))),
    incomplete: pr.filesTruncated === true || renameEvidenceIncomplete || countIncomplete,
  };
}

function explicitNegative(body, role) {
  const value = text(body);
  if (/\bRESULT\s*:\s*STALE\b/i.test(value)) return true;
  if (/\bVERDICT\s*:\s*(?:R[012]\s*=\s*)?(?:BLOCKER|INCOMPLETE|FINDINGS)\b/i.test(value)) return true;
  if (new RegExp(`\\b${role}\\s+(?:RESULT|VERDICT)\\s*:\\s*(?:BLOCKER|BLOCKED|INCOMPLETE|STALE)\\b`, 'i').test(value)) return true;
  return false;
}

function structuredReceipt(item) {
  const matches = [...text(item.body).matchAll(/<!-- development-review-receipt\s+(\{[^\n]*\})\s*-->/g)];
  if (matches.length !== 1) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    return null;
  }
}

function independentReceipt(item, role, pr, allowlist) {
  if (!INDEPENDENT_ROLES.includes(role)) return false;
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) return false;
  if (INDEPENDENT_ROLES.some((name) => allowlist[name] !== undefined && !Array.isArray(allowlist[name]))) return false;
  const body = text(item.body);
  const author = text(item.author);
  if (!author || GENERIC_REVIEW_BOTS.has(author) || author === text(pr.author) || explicitNegative(body, role)) return false;
  const allowed = Array.isArray(allowlist[role]) ? allowlist[role] : [];
  if (!allowed.includes(author)) return false;
  if (INDEPENDENT_ROLES.some((other) => other !== role && (allowlist[other] ?? []).includes(author))) return false;
  const receipt = structuredReceipt(item);
  if (!receipt || receipt.role !== role || receipt.prNumber !== pr.number
    || !SHA.test(text(receipt.headSha)) || !SHA.test(text(receipt.baseSha))
    || receipt.headSha !== pr.headSha || receipt.baseSha !== pr.baseSha
    || (item.source === 'review' && item.commitOid !== receipt.headSha)
    || (item.source !== 'review' && item.commitOid && item.commitOid !== receipt.headSha)
    || !Number.isSafeInteger(item.id) || !item.url) return false;
  return true;
}

function positiveReceipt(item, role, pr, config) {
  const body = text(item.body);
  const author = text(item.author);
  if (explicitNegative(body, role)) return false;

  if (role === 'R0') {
    const claimsUnresolved = /unresolved[^\n]*(?:issue|finding|remain)|(?:issue|finding)[^\n]*remain[^\n]*unresolved/i.test(body);
    const nativeCopilot = /copilot-pull-request-reviewer/i.test(author)
      && text(item.commitOid).toLowerCase() === text(pr.headSha).toLowerCase()
      && /\*\*Findings:\*\*\s*None\b/i.test(body)
      && !claimsUnresolved;
    return nativeCopilot;
  }
  return independentReceipt(item, role, pr, config.trustedReceiptActorsByRole);
}

function receiptTime(item) {
  return text(item.updatedAt ?? item.submittedAt ?? item.createdAt);
}

function independentNegative(item, role, pr, allowlist) {
  if (!INDEPENDENT_ROLES.includes(role) || !explicitNegative(item.body, role)) return false;
  if (!allowlist || typeof allowlist !== 'object' || Array.isArray(allowlist)) return false;
  if (INDEPENDENT_ROLES.some((name) => allowlist[name] !== undefined && !Array.isArray(allowlist[name]))) return false;
  const author = text(item.author);
  const allowed = Array.isArray(allowlist[role]) ? allowlist[role] : [];
  if (!author || !allowed.includes(author) || GENERIC_REVIEW_BOTS.has(author)
    || author === text(pr.author)) return false;
  if (INDEPENDENT_ROLES.some((other) => other !== role && (allowlist[other] ?? []).includes(author))) return false;
  const body = text(item.body);
  const exactHead = item.source === 'review'
    ? text(item.commitOid).toLowerCase() === text(pr.headSha).toLowerCase()
    : text(item.commitOid).toLowerCase() === text(pr.headSha).toLowerCase()
      || body.toLowerCase().includes(text(pr.headSha).toLowerCase());
  return exactHead && new RegExp(`\\b${role}\\b`, 'i').test(body);
}

function negativeReceipt(item, role, pr, config) {
  if (role === 'R0') {
    const body = text(item.body);
    const nativeCopilot = /copilot-pull-request-reviewer/i.test(text(item.author))
      && text(item.commitOid).toLowerCase() === text(pr.headSha).toLowerCase();
    if (!nativeCopilot) return false;
    const nativeNoFindings = /\*\*Findings:\*\*\s*None\b/i.test(body);
    const claimsUnresolved = /unresolved[^\n]*(?:issue|finding|remain)|(?:issue|finding)[^\n]*remain[^\n]*unresolved/i.test(body);
    return !nativeNoFindings || claimsUnresolved;
  }
  if (!explicitNegative(item.body, role)) return false;
  return independentNegative(item, role, pr, config.trustedReceiptActorsByRole);
}

export function reviewReceipts(pr, config) {
  // Independent acceptance is PR-local by design. Issue #65 is a temporary
  // coordination channel and must never become durable review authority.
  const items = [
    ...(pr.reviews ?? []).map((item) => ({ ...item, source: 'review' })),
    ...(pr.comments ?? []).map((item) => ({ ...item, source: 'pr-comment' })),
  ];

  const result = {};
  for (const role of ['R0', 'R1', 'R2']) {
    const positive = items
      .filter((item) => positiveReceipt(item, role, pr, config))
      .sort((left, right) => receiptTime(right).localeCompare(receiptTime(left)))[0] ?? null;
    const negative = items
      .filter((item) => negativeReceipt(item, role, pr, config))
      .sort((left, right) => receiptTime(right).localeCompare(receiptTime(left)))[0] ?? null;
    const accepted = positive && (!negative || receiptTime(positive).localeCompare(receiptTime(negative)) > 0)
      ? positive
      : null;
    result[role.toLowerCase()] = accepted ? {
      status: 'accepted',
      id: accepted.id ?? null,
      source: accepted.source,
      author: accepted.author,
      at: accepted.updatedAt ?? accepted.submittedAt ?? accepted.createdAt ?? null,
      url: accepted.url ?? null,
      reviewedSha: pr.headSha,
    } : { status: 'missing', reviewedSha: null };
  }
  return result;
}

function negativeRoleRequirement(value, role) {
  return [
    `${role} gerekmez`,
    `${role} gerekmiyor`,
    `${role} beklenmiyor`,
    `${role} not required`,
    `no ${role}`,
  ].some((phrase) => value.includes(phrase));
}

export function taskReviewRequirements(task) {
  const value = lower(task?.rawLine ?? `${text(task?.owner)} | ${text(task?.evidence)}`);
  const mentions = {
    r1: /(?:^|[^a-z0-9])r1(?:[^a-z0-9]|$)/i.test(value),
    r2: /(?:^|[^a-z0-9])r2(?:[^a-z0-9]|$)/i.test(value),
  };
  const hasReviewBudget = mentions.r1 || mentions.r2;
  return Object.fromEntries(['r1', 'r2'].map((role) => {
    if (negativeRoleRequirement(value, role)) return [role, 'not_required'];
    if (mentions[role]) return [role, 'required'];
    return [role, hasReviewBudget ? 'not_required' : 'unknown'];
  }));
}

function hasUnclosedExternalGate(evidence) {
  const value = text(evidence);
  return /(?:hosted|staging|gerçek hesap|real-account)[^\n|]{0,100}(?:beklen|pending|gerekli|zorunlu|kapanış)/i.test(value)
    && !/(?:hosted|staging|gerçek hesap|real-account)[^\n|]{0,100}(?:success|başarılı|acceptable|tamamlandı|kapandı)/i.test(value);
}

export function classifyPull(pr, context) {
  const {
    config,
    mainSha,
    task,
    remoteComplete = true,
    baseRelation = null,
  } = context;
  const ci = ciForPull(pr, config.requiredCheckName);
  const surface = changedSurface(pr, config);
  const receipts = reviewReceipts(pr, config);
  const taskRequirements = taskReviewRequirements(task);
  const required = {
    r0: !surface.docsOnly,
    r1: !surface.docsOnly && (taskRequirements.r1 === 'required'
      || (taskRequirements.r1 === 'unknown' && surface.r1ByPath)),
    r2: !surface.docsOnly && (taskRequirements.r2 === 'required'
      || (taskRequirements.r2 === 'unknown' && surface.r2ByPath)),
  };
  const missingReviews = Object.entries(required)
    .filter(([role, needed]) => needed && receipts[role].status !== 'accepted')
    .map(([role]) => role.toUpperCase());
  const relation = baseRelation ?? {
    kind: 'main',
    current: Boolean(mainSha) && pr.baseSha === mainSha,
    mergeTargetCurrent: Boolean(mainSha) && pr.baseSha === mainSha,
    gap: pr.baseSha === mainSha ? null : 'BASE_NOT_CURRENT_MAIN',
    parentPrNumber: null,
    parentTaskId: null,
  };
  const gaps = [];
  if (!remoteComplete) gaps.push('REMOTE_EVIDENCE_INCOMPLETE');
  if (!task) gaps.push('TASK_NOT_MAPPED');
  if (surface.incomplete) gaps.push('FILES_TRUNCATED');
  if (pr.threadsTruncated) gaps.push('THREADS_TRUNCATED');
  if (ci.status === 'missing') gaps.push('CI_GATE_MISSING');
  if (relation.gap) gaps.push(relation.gap);
  if (pr.fromFork) gaps.push('CROSS_REPOSITORY_HEAD');
  const taskAuthority = task?.rawLine ?? `${text(task?.owner)} | ${text(task?.evidence)}`;
  if (hasUnclosedExternalGate(taskAuthority)) gaps.push('EXTERNAL_ACCEPTANCE_PENDING');
  for (const role of missingReviews) gaps.push(`${role}_RECEIPT_MISSING_OR_STALE`);

  const baseCurrent = relation.current === true;
  const mergeTargetCurrent = relation.mergeTargetCurrent === true;
  const stackPending = relation.kind === 'stack' && relation.current === true;
  const taskReviewState = task?.status === 'İncelemede';
  const cleanMergeState = pr.mergeable === 'MERGEABLE' && pr.mergeStateStatus === 'CLEAN';
  const threadsClear = Number.isInteger(pr.unresolvedThreads) && pr.unresolvedThreads === 0 && !pr.threadsTruncated;
  const evidenceComplete = remoteComplete && !surface.incomplete;

  let choice = 'A';
  let reason = 'Kanıt veya beklenen dış koşul henüz tamamlanmadı.';
  if (ci.status === 'fail') {
    choice = 'B';
    reason = 'Exact-head CI gate başarısız; aynı branch üzerinde dar onarım gerekir.';
  } else if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    choice = 'B';
    reason = 'PR güncel main ile çakışıyor; history-safe entegrasyon onarımı gerekir.';
  } else if (pr.unresolvedThreads > 0 && !pr.threadsTruncated) {
    choice = 'B';
    reason = 'Açık review thread’leri kapanmadan kabul ilerleyemez.';
  } else if (stackPending) {
    choice = 'A';
    reason = `Canonical stacked PR: parent #${relation.parentPrNumber} (${relation.parentTaskId}) main'e alınmadan bu PR ready/merge olmaz.`;
  } else if (!task || !evidenceComplete || !baseCurrent || ci.status !== 'pass') {
    choice = 'A';
    reason = !task
      ? 'PR canlı TASKS satırıyla eşleşmiyor; otomatik sahiplik çıkarımı yapılmadı.'
      : relation.gap === 'STACK_PARENT_HEAD_STALE'
        ? `Stack parent #${relation.parentPrNumber} ilerledi; child yalnız parent head ile senkronlanmalı, main'e zorla düzleştirilmemeli.`
        : relation.gap === 'STACK_BASE_NOT_DECLARED'
          ? 'PR base branch’i TASKS bağımlılığıyla doğrulanamadı; stack yetkisi belirsiz.'
          : !baseCurrent
            ? 'PR tabanı güncel main değil; güncel entegrasyon kanıtı bekleniyor.'
            : ci.status === 'pending'
              ? 'Exact-head CI gate tamamlanmayı bekliyor.'
              : 'Merge için gerekli kanıt eksik veya kesilmiş.';
  } else if (pr.draft || missingReviews.length > 0 || hasUnclosedExternalGate(taskAuthority)) {
    choice = 'C';
    reason = pr.draft
      ? 'CI ve taban uygun; PR review/ready aşamasına taşınmalı.'
      : missingReviews.length > 0
        ? `Güncel ${missingReviews.join('/')} receipt’i gerekiyor.`
        : 'Repo dışı acceptance kanıtı kapanmadan merge edilemez.';
  } else if (!taskReviewState) {
    choice = 'A';
    reason = 'TASKS durumu merge kabulüne uygun değil.';
  } else if (cleanMergeState && threadsClear && !pr.fromFork) {
    choice = 'D';
    reason = 'Tüm deterministik merge kapıları exact current head üzerinde kapalı.';
  } else {
    choice = 'A';
    reason = 'GitHub mergeability veya thread kanıtı henüz temiz değil.';
  }

  const readyEligible = pr.draft
    && taskReviewState
    && evidenceComplete
    && baseCurrent
    && mergeTargetCurrent
    && ci.status === 'pass'
    && cleanMergeState
    && threadsClear
    && !pr.fromFork;
  const mergeEligible = choice === 'D'
    && !pr.draft
    && gaps.length === 0
    && missingReviews.length === 0;

  return {
    prNumber: pr.number,
    taskId: task?.id ?? null,
    choice,
    label: CHOICES[choice],
    reason,
    ci,
    surface,
    requiredReviews: required,
    receipts,
    missingReviews,
    unresolvedThreads: pr.unresolvedThreads,
    gaps: unique(gaps),
    baseRelation: relation,
    readyEligible,
    mergeEligible,
  };
}

export function policyFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
