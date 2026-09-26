import { cacheKey, stableJson } from '../core/cache.mjs';

export const JEV_UTILITY_ROUTER_GATE = 'JEV_UTILITY_ROUTER_GATE-v0.1';

const QUESTION_CLASSES = new Set([
  'relation-judgment',
  'blind-spot-triage',
  'experiment-choice',
  'candidate-prioritization',
  'contradiction-triage',
  'evidence-compression',
]);

const CACHE_STATES = new Set(['hit', 'miss', 'invalid', 'unavailable']);
const EVIDENCE_STATES = new Set(['complete', 'partial', 'insufficient']);
const ROUTES = new Set(['deterministic', 'cache', 'single-live', 'fanout-live', 'abstain']);

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const integerNonNegative = (value) => Number.isInteger(value) && value >= 0;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validateMonetaryCeiling(value) {
  if (value == null) return null;
  assert(value && typeof value === 'object' && !Array.isArray(value),
    'monetary ceiling must be an object or null');
  assert(finiteNonNegative(value.amount), 'monetary ceiling amount must be non-negative');
  assert(nonEmpty(value.currency), 'monetary ceiling currency required');
  assert(nonEmpty(value.rateEvidence), 'monetary ceiling rate evidence required');
  return value;
}

function validateFanout(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value),
    'fanout policy required');
  assert(typeof value.requested === 'boolean' && typeof value.eligible === 'boolean',
    'fanout requested/eligible flags required');
  assert(Number.isInteger(value.calls) && value.calls >= 1 && value.calls <= 20,
    'fanout calls must be an integer between 1 and 20');
  if (value.requested) {
    assert(nonEmpty(value.policyVersion), 'requested fanout requires policyVersion');
    assert(nonEmpty(value.disagreementMetric), 'requested fanout requires disagreementMetric');
    assert(nonEmpty(value.stoppingRule), 'requested fanout requires stoppingRule');
  }
  return value;
}

export function validateJevQuestionCandidate(input) {
  const candidate = structuredClone(input);
  assert(candidate?.schemaVersion === 1
    && candidate.kind === 'h19-jev-question-candidate',
  'unsupported Jev question candidate');

  const question = candidate.question;
  assert(question && typeof question === 'object', 'question required');
  assert(nonEmpty(question.id) && nonEmpty(question.version), 'question id/version required');
  assert(QUESTION_CLASSES.has(question.class), 'unsupported Jev question class');
  assert(sha256(question.inputSha256), 'question inputSha256 required');

  const evidence = candidate.evidence;
  assert(evidence && typeof evidence === 'object', 'evidence routing metadata required');
  assert(EVIDENCE_STATES.has(evidence.completeness), 'invalid evidence completeness');
  assert(integerNonNegative(evidence.unknownCount), 'unknownCount must be a non-negative integer');
  assert(integerNonNegative(evidence.conflictCount), 'conflictCount must be a non-negative integer');
  assert(typeof evidence.lineageOverlap === 'boolean', 'lineageOverlap flag required');

  const deterministic = candidate.deterministic;
  assert(deterministic && typeof deterministic === 'object'
    && typeof deterministic.available === 'boolean',
  'deterministic routing metadata required');
  if (deterministic.available) {
    assert(sha256(deterministic.resolutionSha256),
      'deterministic resolution requires resolutionSha256');
  } else {
    assert(deterministic.resolutionSha256 == null,
      'unavailable deterministic resolution cannot carry resolutionSha256');
  }

  const cache = candidate.cache;
  assert(cache && typeof cache === 'object' && CACHE_STATES.has(cache.status),
    'cache routing metadata required');
  if (cache.status === 'hit') {
    assert(nonEmpty(cache.cacheKey) && sha256(cache.answerSha256),
      'cache hit requires key and answer digest');
  } else if (cache.status === 'invalid') {
    assert(nonEmpty(cache.cacheKey), 'invalid cache requires cache key');
    assert(cache.answerSha256 == null || sha256(cache.answerSha256),
      'invalid cache answer digest must be null or sha256');
  } else {
    assert(cache.answerSha256 == null,
      'non-hit cache cannot carry answer digest');
  }

  const live = candidate.live;
  assert(live && typeof live === 'object' && typeof live.allowed === 'boolean',
    'live routing metadata required');
  assert(Number.isInteger(live.maxLiveQuestions)
    && live.maxLiveQuestions >= 0
    && live.maxLiveQuestions <= 20,
  'maxLiveQuestions must be an integer between 0 and 20');
  assert(integerNonNegative(live.maxInputTokens), 'maxInputTokens must be non-negative');
  assert(integerNonNegative(live.maxOutputTokens), 'maxOutputTokens must be non-negative');
  assert(Number.isInteger(live.timeoutMs) && live.timeoutMs > 0,
    'live timeoutMs must be a positive integer');
  assert(live.evaluationMethodId == null || nonEmpty(live.evaluationMethodId),
    'evaluationMethodId must be null or non-empty');
  validateMonetaryCeiling(live.monetaryCeiling);
  validateFanout(live.fanout);

  if (!live.allowed) {
    assert(live.maxLiveQuestions === 0,
      'disabled live route must have zero live-question budget');
  }

  return deepFreeze(candidate);
}

function candidateDigest(candidate) {
  return cacheKey('h19-jev-question-candidate:v1', candidate);
}

function decisionBody(candidate, route, reasonCode, plannedLiveQuestions) {
  return {
    schemaVersion: 1,
    kind: 'h19-jev-utility-route-decision',
    gate: JEV_UTILITY_ROUTER_GATE,
    candidateSha256: candidateDigest(candidate),
    question: structuredClone(candidate.question),
    route,
    reasonCode,
    plannedLiveQuestions,
    providerBudget: {
      maxLiveQuestions: candidate.live.maxLiveQuestions,
      maxInputTokens: candidate.live.maxInputTokens,
      maxOutputTokens: candidate.live.maxOutputTokens,
      monetaryCeiling: structuredClone(candidate.live.monetaryCeiling),
      timeoutMs: candidate.live.timeoutMs,
    },
    evaluationMethodId: candidate.live.evaluationMethodId,
    evidenceState: {
      completeness: candidate.evidence.completeness,
      unknownCount: candidate.evidence.unknownCount,
      conflictCount: candidate.evidence.conflictCount,
      lineageOverlap: candidate.evidence.lineageOverlap,
    },
    fanoutPlan: structuredClone(candidate.live.fanout),
    authority: 'advisory',
    liveExecutionPerformed: false,
  };
}

export function routeJevQuestion(input) {
  const candidate = validateJevQuestionCandidate(input);

  let route;
  let reasonCode;
  let plannedLiveQuestions = 0;

  if (candidate.deterministic.available) {
    route = 'deterministic';
    reasonCode = 'deterministic-resolution-available';
  } else if (candidate.cache.status === 'hit') {
    route = 'cache';
    reasonCode = 'exact-cache-hit';
  } else if (candidate.cache.status === 'invalid') {
    route = 'abstain';
    reasonCode = 'invalid-cache-fail-closed';
  } else if (candidate.evidence.completeness === 'insufficient') {
    route = 'abstain';
    reasonCode = 'evidence-insufficient';
  } else if (!candidate.live.evaluationMethodId) {
    route = 'abstain';
    reasonCode = 'evaluation-contract-missing';
  } else if (!candidate.live.allowed) {
    route = 'abstain';
    reasonCode = 'live-provider-disabled';
  } else if (candidate.live.maxLiveQuestions === 0) {
    route = 'abstain';
    reasonCode = 'live-question-budget-zero';
  } else if (candidate.live.maxInputTokens === 0 || candidate.live.maxOutputTokens === 0) {
    route = 'abstain';
    reasonCode = 'live-token-budget-zero';
  } else if (!candidate.live.monetaryCeiling) {
    route = 'abstain';
    reasonCode = 'monetary-ceiling-missing';
  } else if (candidate.live.monetaryCeiling.amount === 0) {
    route = 'abstain';
    reasonCode = 'monetary-ceiling-zero';
  } else if (candidate.live.fanout.requested) {
    if (!candidate.live.fanout.eligible) {
      route = 'single-live';
      reasonCode = 'fanout-not-eligible-single-fallback';
      plannedLiveQuestions = 1;
    } else if (candidate.live.fanout.calls > candidate.live.maxLiveQuestions) {
      route = 'abstain';
      reasonCode = 'fanout-budget-exceeded';
    } else if (candidate.live.fanout.calls < 2) {
      route = 'single-live';
      reasonCode = 'fanout-degenerate-single';
      plannedLiveQuestions = 1;
    } else {
      route = 'fanout-live';
      reasonCode = 'prospective-fanout-authorized';
      plannedLiveQuestions = candidate.live.fanout.calls;
    }
  } else {
    route = 'single-live';
    reasonCode = 'bounded-live-question-eligible';
    plannedLiveQuestions = 1;
  }

  const body = decisionBody(candidate, route, reasonCode, plannedLiveQuestions);
  const decisionSha256 = cacheKey('h19-jev-utility-route:v1', body);
  return deepFreeze({ ...body, decisionSha256 });
}

export function validateJevRouteDecision(decision, { candidate } = {}) {
  assert(decision?.schemaVersion === 1
    && decision.kind === 'h19-jev-utility-route-decision'
    && decision.gate === JEV_UTILITY_ROUTER_GATE,
  'unsupported Jev route decision');
  assert(sha256(decision.candidateSha256), 'candidate digest required');
  assert(ROUTES.has(decision.route), 'invalid Jev route');
  assert(nonEmpty(decision.reasonCode), 'route reasonCode required');
  assert(integerNonNegative(decision.plannedLiveQuestions),
    'plannedLiveQuestions must be non-negative');
  assert(decision.authority === 'advisory' && decision.liveExecutionPerformed === false,
    'route decision cannot claim execution/authority');
  assert(sha256(decision.decisionSha256), 'route decision digest required');

  const { decisionSha256, ...body } = structuredClone(decision);
  assert(cacheKey('h19-jev-utility-route:v1', body) === decisionSha256,
    'route decision digest mismatch');

  if (decision.route === 'single-live') {
    assert(decision.plannedLiveQuestions === 1,
      'single-live must plan one live question');
  } else if (decision.route === 'fanout-live') {
    assert(decision.plannedLiveQuestions >= 2,
      'fanout-live must plan at least two questions');
  } else {
    assert(decision.plannedLiveQuestions === 0,
      'non-live routes cannot plan live questions');
  }

  if (candidate) {
    const validated = validateJevQuestionCandidate(candidate);
    assert(decision.candidateSha256 === candidateDigest(validated),
      'route decision candidate mismatch');
    const replay = routeJevQuestion(validated);
    assert(stableJson(replay) === stableJson(decision),
      'route decision replay mismatch');
  }
  return decision;
}
