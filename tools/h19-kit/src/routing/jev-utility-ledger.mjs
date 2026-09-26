import { cacheKey } from '../core/cache.mjs';
import { validateJevRouteDecision } from './jev-utility-router.mjs';

const ATTEMPT_STATES = new Set(['answered', 'insufficient', 'error']);
const EVALUATION_STATES = new Set(['pending', 'confirmed', 'rejected', 'unresolved', 'not-applicable']);
const LIVE_ROUTES = new Set(['single-live', 'fanout-live']);

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

function validateAttempt(attempt, index, decision) {
  assert(attempt?.index === index, 'fake Jev attempt index mismatch');
  assert(ATTEMPT_STATES.has(attempt.status), 'invalid fake Jev attempt status');
  assert(integerNonNegative(attempt.inputTokens), 'attempt inputTokens must be non-negative');
  assert(integerNonNegative(attempt.outputTokens), 'attempt outputTokens must be non-negative');
  assert(attempt.inputTokens <= decision.providerBudget.maxInputTokens,
    'attempt input token budget exceeded');
  assert(attempt.outputTokens <= decision.providerBudget.maxOutputTokens,
    'attempt output token budget exceeded');
  assert(finiteNonNegative(attempt.latencyMs), 'attempt latencyMs must be non-negative');
  assert(finiteNonNegative(attempt.cost?.amount), 'attempt cost amount must be non-negative');
  assert(nonEmpty(attempt.cost?.currency), 'attempt cost currency required');
  assert(nonEmpty(attempt.cost?.rateEvidence), 'attempt cost rate evidence required');
  assert(attempt.providerConfidence == null
    || (Number.isFinite(attempt.providerConfidence)
      && attempt.providerConfidence >= 0
      && attempt.providerConfidence <= 1),
  'providerConfidence must be null or between 0 and 1');

  if (attempt.status === 'error') {
    assert(attempt.answerSha256 == null, 'error attempt cannot carry answerSha256');
    assert(nonEmpty(attempt.errorCode), 'error attempt requires errorCode');
  } else {
    assert(sha256(attempt.answerSha256), 'answered attempt requires answerSha256');
    assert(attempt.errorCode == null, 'answered attempt cannot carry errorCode');
  }

  return attempt;
}

export function freezeFakeJevExecutionObservation({
  decision,
  provider = 'fake-provider',
  model = 'fake-model',
  attempts = [],
  wallMs = 0,
  evaluation = null,
  downstreamRecommendationChanged = null,
} = {}) {
  validateJevRouteDecision(decision);
  assert(nonEmpty(provider) && nonEmpty(model), 'fake provider/model required');
  assert(Array.isArray(attempts), 'fake attempts array required');
  assert(finiteNonNegative(wallMs), 'fake wallMs must be non-negative');
  assert(downstreamRecommendationChanged == null
    || typeof downstreamRecommendationChanged === 'boolean',
  'downstreamRecommendationChanged must be boolean or null');

  const live = LIVE_ROUTES.has(decision.route);
  if (live) {
    assert(attempts.length === decision.plannedLiveQuestions,
      'fake live attempt count must equal planned live questions');
  } else {
    assert(attempts.length === 0,
      'non-live route cannot carry provider attempts');
  }

  attempts.forEach((attempt, index) => validateAttempt(attempt, index, decision));

  const totalCost = attempts.reduce((sum, attempt) => sum + attempt.cost.amount, 0);
  const currencies = new Set(attempts.map((attempt) => attempt.cost.currency));
  if (live) {
    assert(currencies.size === 1, 'one observation cannot mix provider currencies');
    assert(decision.providerBudget.monetaryCeiling,
      'live route must retain monetary ceiling');
    const [currency] = currencies;
    assert(currency === decision.providerBudget.monetaryCeiling.currency,
      'attempt currency differs from route ceiling');
    assert(totalCost <= decision.providerBudget.monetaryCeiling.amount,
      'fake provider cost exceeds monetary ceiling');
  }

  const normalizedEvaluation = evaluation ?? {
    status: live ? 'pending' : 'not-applicable',
    methodId: live ? decision.evaluationMethodId : null,
  };
  assert(EVALUATION_STATES.has(normalizedEvaluation.status),
    'invalid Jev evaluation status');
  if (live) {
    assert(normalizedEvaluation.methodId === decision.evaluationMethodId,
      'Jev evaluation method differs from route decision');
    assert(normalizedEvaluation.status !== 'not-applicable',
      'live route evaluation cannot be not-applicable');
  } else {
    assert(normalizedEvaluation.status === 'not-applicable'
      && normalizedEvaluation.methodId == null,
    'non-live route evaluation must be not-applicable');
  }

  const body = {
    schemaVersion: 1,
    kind: 'h19-jev-utility-fake-observation',
    decisionSha256: decision.decisionSha256,
    candidateSha256: decision.candidateSha256,
    route: decision.route,
    provider,
    model,
    attempts: structuredClone(attempts),
    wallMs,
    evaluation: structuredClone(normalizedEvaluation),
    downstreamRecommendationChanged,
    executionMode: 'fake',
    authority: 'advisory',
  };

  return deepFreeze({
    ...body,
    observationSha256: cacheKey('h19-jev-utility-observation:v1', body),
  });
}

export function validateFakeJevExecutionObservation(observation, { decision } = {}) {
  assert(observation?.schemaVersion === 1
    && observation.kind === 'h19-jev-utility-fake-observation'
    && observation.executionMode === 'fake'
    && observation.authority === 'advisory',
  'unsupported fake Jev utility observation');
  assert(sha256(observation.observationSha256), 'fake observation digest required');
  const { observationSha256, ...body } = structuredClone(observation);
  assert(cacheKey('h19-jev-utility-observation:v1', body) === observationSha256,
    'fake observation digest mismatch');

  if (decision) {
    const replay = freezeFakeJevExecutionObservation({
      decision,
      provider: observation.provider,
      model: observation.model,
      attempts: observation.attempts,
      wallMs: observation.wallMs,
      evaluation: observation.evaluation,
      downstreamRecommendationChanged: observation.downstreamRecommendationChanged,
    });
    assert(replay.observationSha256 === observation.observationSha256,
      'fake observation decision replay mismatch');
  }
  return observation;
}

export function buildJevUtilityLedger(observations, { decisions } = {}) {
  assert(Array.isArray(observations), 'Jev utility observations array required');
  assert(Array.isArray(decisions), 'exact Jev route decisions array required');

  const decisionIndex = new Map();
  for (const decision of decisions) {
    validateJevRouteDecision(decision);
    assert(!decisionIndex.has(decision.decisionSha256), 'duplicate Jev route decision');
    decisionIndex.set(decision.decisionSha256, decision);
  }

  const seen = new Set();

  const counts = {
    observations: observations.length,
    deterministic: 0,
    cache: 0,
    singleLive: 0,
    fanoutLive: 0,
    abstain: 0,
    providerRequests: 0,
    answered: 0,
    insufficient: 0,
    error: 0,
    evaluationPending: 0,
    evaluationConfirmed: 0,
    evaluationRejected: 0,
    evaluationUnresolved: 0,
    resolvedEvaluableQuestions: 0,
    downstreamRecommendationChanged: 0,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let wallMs = 0;
  const costs = new Map();

  for (const observation of observations) {
    const decision = decisionIndex.get(observation.decisionSha256);
    assert(decision, 'Jev utility observation missing exact route decision');
    validateFakeJevExecutionObservation(observation, { decision });
    assert(!seen.has(observation.observationSha256), 'duplicate Jev utility observation');
    seen.add(observation.observationSha256);

    if (observation.route === 'deterministic') counts.deterministic += 1;
    else if (observation.route === 'cache') counts.cache += 1;
    else if (observation.route === 'single-live') counts.singleLive += 1;
    else if (observation.route === 'fanout-live') counts.fanoutLive += 1;
    else if (observation.route === 'abstain') counts.abstain += 1;
    else throw new Error('unknown Jev route in utility observation');

    counts.providerRequests += observation.attempts.length;
    wallMs += observation.wallMs;
    if (observation.downstreamRecommendationChanged === true) {
      counts.downstreamRecommendationChanged += 1;
    }

    for (const attempt of observation.attempts) {
      inputTokens += attempt.inputTokens;
      outputTokens += attempt.outputTokens;
      counts[attempt.status] += 1;
      const current = costs.get(attempt.cost.currency) ?? {
        currency: attempt.cost.currency,
        amount: 0,
        rateEvidence: new Set(),
      };
      current.amount += attempt.cost.amount;
      current.rateEvidence.add(attempt.cost.rateEvidence);
      costs.set(attempt.cost.currency, current);
    }

    if (observation.evaluation.status === 'pending') counts.evaluationPending += 1;
    else if (observation.evaluation.status === 'confirmed') {
      counts.evaluationConfirmed += 1;
      counts.resolvedEvaluableQuestions += 1;
    } else if (observation.evaluation.status === 'rejected') {
      counts.evaluationRejected += 1;
      counts.resolvedEvaluableQuestions += 1;
    } else if (observation.evaluation.status === 'unresolved') {
      counts.evaluationUnresolved += 1;
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const costByCurrency = [...costs.values()]
    .map((item) => ({
      currency: item.currency,
      amount: item.amount,
      rateEvidence: [...item.rateEvidence].sort(),
      costPerResolvedUncertainty: counts.resolvedEvaluableQuestions > 0
        ? item.amount / counts.resolvedEvaluableQuestions
        : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const body = {
    schemaVersion: 1,
    kind: 'h19-jev-utility-ledger',
    counts,
    usage: {
      inputTokens,
      outputTokens,
      totalProviderTokens: totalTokens,
      wallMs,
      costByCurrency,
    },
    utility: {
      resolvedEvaluableQuestionsPerProviderToken: totalTokens > 0
        ? counts.resolvedEvaluableQuestions / totalTokens
        : null,
      falseConfidenceCases: null,
      informationGain: null,
    },
    limits: [
      'Fake observations only; this ledger is a contract smoke, not empirical Jev performance.',
      'A provider answer alone never counts as resolved uncertainty.',
      'Confirmed and rejected evaluations both indicate that the evaluable question was resolved against later evidence.',
      'False-confidence requires a separate preregistered confidence threshold and is null here.',
      'Information gain is null without a preregistered prior/posterior update contract.',
    ],
  };

  return deepFreeze({
    ...body,
    ledgerSha256: cacheKey('h19-jev-utility-ledger:v1', body),
  });
}
