import { createHash } from 'node:crypto';

import { stableJson } from '../core/cache.mjs';
import {
  RELATION_DIRECTION_QUESTION,
  freezeJevRelationalJudgment,
  relationalInputDigest,
  validateJevRelationalJudgment,
  validateRelationalEvidenceCase,
} from './relational-evidence.mjs';
import { validateRelationalCaseBatch } from './relational-case-composer.mjs';
import {
  JEV_RELATIONAL_CACHE_NAMESPACE,
  JEV_RELATIONAL_MODEL,
  RELATION_CHOICE_DOMAIN,
  TYPESAFE_SYSTEMONE_URL,
  acceptJevRelationalSingleCaseResponse,
  buildJevRelationalSingleCaseRequest,
  classifyJevRelationalCacheValue,
  freezeJevRelationalCacheEntry,
  jevRelationalCacheKey,
  jevRelationalRequestSha256,
  normalizeRelationProbabilities,
  relationalTransportErrorCode,
  validateJevRelationalCacheEntry,
} from '../adapters/jev-relational.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const hashBody = (value) => sha256(`${stableJson(value)}\n`);

export const RELATIONAL_JUDGMENT_GATE = 'RELATIONAL_JUDGMENT_BATCH_GATE-v0.3';
export const RELATIONAL_JUDGMENT_MAX_LIVE_QUESTIONS = 20;
const CACHE_STATUSES = ['hit', 'miss', 'upgrade-required', 'invalid'];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function shaLike(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function normalizeMaxLiveQuestions(value) {
  if (!Number.isInteger(value)
    || value < 0
    || value > RELATIONAL_JUDGMENT_MAX_LIVE_QUESTIONS) {
    throw new TypeError('maxLiveQuestions must be an integer between 0 and 20');
  }
  return value;
}

function exactCaseIndex(batch, relationalCases) {
  validateRelationalCaseBatch(batch, { relationalCases });
  if (!Array.isArray(relationalCases)) throw new TypeError('relationalCases required');

  const bySha = new Map();
  for (const relationalCase of relationalCases) {
    validateRelationalEvidenceCase(relationalCase);
    if (bySha.has(relationalCase.caseSha256)) {
      throw new Error(`duplicate relational case artifact: ${relationalCase.caseSha256}`);
    }
    bySha.set(relationalCase.caseSha256, relationalCase);
  }

  if (bySha.size !== batch.cases.length) {
    throw new Error('relational case artifact set does not exactly match batch');
  }

  for (const summary of batch.cases) {
    const relationalCase = bySha.get(summary.caseSha256);
    if (!relationalCase) throw new Error(`missing relational case artifact: ${summary.caseSha256}`);
    if (relationalCase.hypothesis.hypothesisId !== summary.hypothesisId) {
      throw new Error('relational case hypothesis binding mismatch');
    }
  }
  return bySha;
}

function freezeRequestPlan(body) {
  return deepFreeze({ ...body, requestPlanSha256: hashBody(body) });
}

export function buildRelationalJudgmentRequestPlan({
  batch,
  relationalCases,
  provider = 'typesafe',
  model = JEV_RELATIONAL_MODEL,
} = {}) {
  if (!nonEmpty(provider) || !nonEmpty(model)) throw new TypeError('provider and model required');
  if (provider !== 'typesafe') throw new Error(`unsupported relational judgment provider: ${provider}`);

  const bySha = exactCaseIndex(batch, relationalCases);
  const rows = batch.cases.map((summary) => {
    const relationalCase = bySha.get(summary.caseSha256);
    return deepFreeze({
      hypothesisId: summary.hypothesisId,
      caseSha256: relationalCase.caseSha256,
      inputSha256: relationalInputDigest(relationalCase),
      provider,
      model,
      questionId: RELATION_DIRECTION_QUESTION.id,
      questionVersion: RELATION_DIRECTION_QUESTION.version,
      cacheKey: jevRelationalCacheKey({ relationalCase, provider, model }),
    });
  });

  return freezeRequestPlan({
    schemaVersion: 1,
    batchSha256: batch.batchSha256,
    compositionInputSha256: batch.compositionInputSha256,
    provider,
    model,
    questionId: RELATION_DIRECTION_QUESTION.id,
    questionVersion: RELATION_DIRECTION_QUESTION.version,
    rows,
  });
}

export function validateRelationalJudgmentRequestPlan(plan, {
  batch = null,
  relationalCases = null,
} = {}) {
  if (!plan?.requestPlanSha256) throw new TypeError('relational judgment request plan required');
  const { requestPlanSha256, ...body } = clone(plan);
  if (hashBody(body) !== requestPlanSha256) throw new Error('relational judgment request plan hash mismatch');
  if (plan.schemaVersion !== 1) throw new Error('unsupported relational judgment request plan version');
  if (!shaLike(plan.batchSha256) || !shaLike(plan.compositionInputSha256)) {
    throw new Error('invalid relational judgment request plan digest binding');
  }
  if (!nonEmpty(plan.provider) || !nonEmpty(plan.model)) throw new Error('request plan provider/model required');
  if (plan.provider !== 'typesafe') throw new Error('unsupported relational judgment provider');
  if (plan.questionId !== RELATION_DIRECTION_QUESTION.id
    || plan.questionVersion !== RELATION_DIRECTION_QUESTION.version) {
    throw new Error('unsupported relational judgment question');
  }
  if (!Array.isArray(plan.rows) || plan.rows.length > 20) {
    throw new Error('invalid relational judgment request plan rows');
  }

  const caseShas = new Set();
  for (const row of plan.rows) {
    if (!nonEmpty(row.hypothesisId)
      || !shaLike(row.caseSha256)
      || !shaLike(row.inputSha256)
      || !nonEmpty(row.cacheKey)) {
      throw new Error('invalid relational judgment request row');
    }
    if (caseShas.has(row.caseSha256)) throw new Error('duplicate request-plan case');
    caseShas.add(row.caseSha256);
    if (row.provider !== plan.provider
      || row.model !== plan.model
      || row.questionId !== plan.questionId
      || row.questionVersion !== plan.questionVersion) {
      throw new Error('request row identity mismatch');
    }
  }

  if (batch || relationalCases) {
    if (!batch || !relationalCases) {
      throw new Error('batch and relationalCases are both required for request-plan replay');
    }
    const replay = buildRelationalJudgmentRequestPlan({
      batch,
      relationalCases,
      provider: plan.provider,
      model: plan.model,
    });
    if (replay.requestPlanSha256 !== plan.requestPlanSha256) {
      throw new Error('relational judgment request plan replay mismatch');
    }
  }
  return plan;
}

function freezeRun(body) {
  return deepFreeze({ ...body, judgmentRunSha256: hashBody(body) });
}

function runCounts(rows) {
  return deepFreeze({
    // "cached" means a successful replay hit, not merely a row whose error
    // originated while reading the cache.
    cached: rows.filter((row) => row.source === 'cache' && row.cacheStatus === 'hit').length,
    live: rows.filter((row) => row.source === 'live').length,
    answered: rows.filter((row) => row.kind === 'answered').length,
    insufficient: rows.filter((row) => row.kind === 'answered' && row.choice === 'insufficient').length,
    error: rows.filter((row) => row.kind === 'error').length,
    skipped: rows.filter((row) => row.kind === 'skipped').length,
  });
}

function assertJudgmentMatchesPlan(judgment, planRow) {
  validateJevRelationalJudgment(judgment);
  if (judgment.caseSha256 !== planRow.caseSha256
    || judgment.inputSha256 !== planRow.inputSha256
    || judgment.provider !== planRow.provider
    || judgment.model !== planRow.model
    || judgment.questionId !== planRow.questionId
    || judgment.questionVersion !== planRow.questionVersion) {
    throw new Error('judgment does not match planned request identity');
  }
}

function answeredRow({
  planRow,
  judgment,
  probabilities,
  source,
  cacheStatus,
  requestSha256 = null,
}) {
  assertJudgmentMatchesPlan(judgment, planRow);
  return deepFreeze({
    kind: 'answered',
    hypothesisId: planRow.hypothesisId,
    caseSha256: planRow.caseSha256,
    cacheStatus,
    judgmentSha256: judgment.judgmentSha256,
    source,
    requestSha256,
    choice: judgment.choice,
    probabilities: structuredClone(probabilities),
    providerConfidence: judgment.providerConfidence,
    errorCode: null,
    reason: null,
  });
}

function errorRow({
  planRow,
  judgment,
  source,
  cacheStatus,
  requestSha256 = null,
}) {
  assertJudgmentMatchesPlan(judgment, planRow);
  return deepFreeze({
    kind: 'error',
    hypothesisId: planRow.hypothesisId,
    caseSha256: planRow.caseSha256,
    cacheStatus,
    judgmentSha256: judgment.judgmentSha256,
    source,
    requestSha256,
    choice: null,
    probabilities: null,
    providerConfidence: null,
    errorCode: judgment.errorCode,
    reason: null,
  });
}

function budgetSkipRow(planRow, cacheStatus) {
  return deepFreeze({
    kind: 'skipped',
    hypothesisId: planRow.hypothesisId,
    caseSha256: planRow.caseSha256,
    cacheStatus,
    judgmentSha256: null,
    source: null,
    requestSha256: null,
    choice: null,
    probabilities: null,
    providerConfidence: null,
    errorCode: null,
    reason: 'live-question-budget',
  });
}

function errorJudgment(relationalCase, planRow, errorCode) {
  return freezeJevRelationalJudgment({
    relationalCase,
    provider: planRow.provider,
    model: planRow.model,
    errorCode,
    inputSha256: planRow.inputSha256,
  });
}

async function probeCache({ cache, relationalCase, planRow }) {
  if (!cache?.get) return { status: 'miss' };
  let value;
  try {
    value = await cache.get(JEV_RELATIONAL_CACHE_NAMESPACE, planRow.cacheKey);
  } catch {
    return { status: 'invalid' };
  }
  return classifyJevRelationalCacheValue(value == null ? value : structuredClone(value), {
    relationalCase,
    provider: planRow.provider,
    model: planRow.model,
  });
}

async function executeSingleCase({
  item,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  const { relationalCase, planRow } = item;

  if (!nonEmpty(apiKey)) {
    return {
      attempted: false,
      requestSha256: null,
      errorCode: 'missing_api_key',
    };
  }

  const request = buildJevRelationalSingleCaseRequest({
    relationalCase,
    model: planRow.model,
  });
  const requestSha256 = jevRelationalRequestSha256(request);
  const options = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(request),
  };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortSignal?.timeout === 'function') {
    options.signal = AbortSignal.timeout(timeoutMs);
  }

  try {
    const response = await fetchImpl(TYPESAFE_SYSTEMONE_URL, options);
    if (!response?.ok) {
      return {
        attempted: true,
        requestSha256,
        errorCode: `http_${Number.isInteger(response?.status) ? response.status : 0}`,
      };
    }

    const accepted = acceptJevRelationalSingleCaseResponse(
      await response.json(),
      { model: planRow.model },
    );
    if (accepted.errorCode) {
      return { attempted: true, requestSha256, errorCode: accepted.errorCode };
    }

    const judgment = freezeJevRelationalJudgment({
      relationalCase,
      provider: planRow.provider,
      model: planRow.model,
      answer: {
        choice: accepted.answer.choice,
        confidence: accepted.answer.confidence,
      },
      inputSha256: planRow.inputSha256,
    });
    const entry = freezeJevRelationalCacheEntry({
      judgment,
      probabilities: accepted.answer.probabilities,
      requestSha256,
    });

    return {
      attempted: true,
      requestSha256,
      judgment,
      entry,
    };
  } catch (error) {
    return {
      attempted: true,
      requestSha256,
      errorCode: relationalTransportErrorCode(error),
    };
  }
}

export async function runRelationalJudgmentBatch({
  batch,
  relationalCases,
  provider = 'typesafe',
  model = JEV_RELATIONAL_MODEL,
  maxLiveQuestions = RELATIONAL_JUDGMENT_MAX_LIVE_QUESTIONS,
  apiKey = '',
  cache = null,
  fetchImpl = fetch,
  timeoutMs = 8_000,
  ...rest
} = {}) {
  if ('maxLiveCalls' in rest) throw new TypeError('maxLiveCalls was replaced by maxLiveQuestions');
  const boundedQuestions = normalizeMaxLiveQuestions(maxLiveQuestions);
  const requestPlan = buildRelationalJudgmentRequestPlan({
    batch,
    relationalCases,
    provider,
    model,
  });
  validateRelationalJudgmentRequestPlan(requestPlan, { batch, relationalCases });

  const bySha = exactCaseIndex(batch, relationalCases);
  const sourceCasesBefore = stableJson(relationalCases);
  const sourceBatchBefore = stableJson(batch);
  const rows = new Array(requestPlan.rows.length);
  const judgments = [];
  const cacheEntries = [];
  const pending = [];

  for (const [index, planRow] of requestPlan.rows.entries()) {
    const relationalCase = bySha.get(planRow.caseSha256);
    const probe = await probeCache({ cache, relationalCase, planRow });
    if (probe.status === 'hit') {
      judgments.push(probe.entry.judgment);
      cacheEntries.push(probe.entry);
      rows[index] = answeredRow({
        planRow,
        judgment: probe.entry.judgment,
        probabilities: probe.entry.probabilities,
        source: 'cache',
        cacheStatus: 'hit',
      });
    } else if (probe.status === 'invalid') {
      const judgment = errorJudgment(relationalCase, planRow, 'invalid_cache');
      judgments.push(judgment);
      rows[index] = errorRow({
        planRow,
        judgment,
        source: 'cache',
        cacheStatus: 'invalid',
      });
    } else {
      pending.push({ index, planRow, relationalCase, cacheStatus: probe.status });
    }
  }

  const selected = pending.slice(0, boundedQuestions);
  for (const item of pending.slice(boundedQuestions)) {
    rows[item.index] = budgetSkipRow(item.planRow, item.cacheStatus);
  }

  // v0.3: every selected case gets its own exact M8 request, all launched concurrently.
  const outcomes = await Promise.all(selected.map((item) => executeSingleCase({
    item,
    apiKey,
    fetchImpl,
    timeoutMs,
  })));

  let providerRequestCount = 0;
  for (let position = 0; position < selected.length; position += 1) {
    const item = selected[position];
    const outcome = outcomes[position];
    if (outcome.attempted) providerRequestCount += 1;

    if (outcome.judgment && outcome.entry) {
      if (cache?.set) {
        await cache.set(JEV_RELATIONAL_CACHE_NAMESPACE, item.planRow.cacheKey, outcome.entry);
      }
      judgments.push(outcome.judgment);
      cacheEntries.push(outcome.entry);
      rows[item.index] = answeredRow({
        planRow: item.planRow,
        judgment: outcome.judgment,
        probabilities: outcome.entry.probabilities,
        source: 'live',
        cacheStatus: item.cacheStatus,
        requestSha256: outcome.requestSha256,
      });
    } else {
      const judgment = errorJudgment(
        item.relationalCase,
        item.planRow,
        outcome.errorCode ?? 'invalid_response',
      );
      judgments.push(judgment);
      rows[item.index] = errorRow({
        planRow: item.planRow,
        judgment,
        source: 'live',
        cacheStatus: item.cacheStatus,
        requestSha256: outcome.requestSha256,
      });
    }
  }

  if (stableJson(relationalCases) !== sourceCasesBefore || stableJson(batch) !== sourceBatchBefore) {
    throw new Error('relational judgment batch mutated source artifacts');
  }

  const counts = runCounts(rows);
  const run = freezeRun({
    schemaVersion: 3,
    gate: RELATIONAL_JUDGMENT_GATE,
    authority: 'advisory',
    batchSha256: batch.batchSha256,
    compositionInputSha256: batch.compositionInputSha256,
    requestPlanSha256: requestPlan.requestPlanSha256,
    provider,
    model,
    questionId: RELATION_DIRECTION_QUESTION.id,
    questionVersion: RELATION_DIRECTION_QUESTION.version,
    maxLiveQuestions: boundedQuestions,
    providerRequestCount,
    rows,
    counts,
  });

  return deepFreeze({
    requestPlan,
    run,
    judgments,
    cacheEntries,
  });
}

function validateRunRow(row) {
  if (!nonEmpty(row.hypothesisId) || !shaLike(row.caseSha256)) {
    throw new Error('invalid judgment run row binding');
  }
  if (!CACHE_STATUSES.includes(row.cacheStatus)) throw new Error('invalid judgment run cache status');
  const liveEligible = row.cacheStatus === 'miss' || row.cacheStatus === 'upgrade-required';

  if (row.kind === 'answered') {
    const probabilities = normalizeRelationProbabilities(row.probabilities);
    if (!shaLike(row.judgmentSha256)
      || !RELATION_CHOICE_DOMAIN.includes(row.choice)
      || !probabilities
      || stableJson(probabilities) !== stableJson(row.probabilities)
      || typeof row.providerConfidence !== 'number'
      || !Number.isFinite(row.providerConfidence)
      || row.providerConfidence < 0
      || row.providerConfidence > 1
      || row.errorCode !== null
      || row.reason !== null
      || !((row.source === 'cache' && row.cacheStatus === 'hit' && row.requestSha256 === null)
        || (row.source === 'live' && liveEligible && shaLike(row.requestSha256)))) {
      throw new Error('invalid answered judgment run row');
    }
  } else if (row.kind === 'error') {
    const missingKey = row.errorCode === 'missing_api_key';
    if (!shaLike(row.judgmentSha256)
      || row.choice !== null
      || row.probabilities !== null
      || row.providerConfidence !== null
      || !nonEmpty(row.errorCode)
      || row.reason !== null
      || !((row.source === 'cache'
        && row.cacheStatus === 'invalid'
        && row.errorCode === 'invalid_cache'
        && row.requestSha256 === null)
        || (row.source === 'live'
          && liveEligible
          && ((missingKey && row.requestSha256 === null)
            || (!missingKey && shaLike(row.requestSha256)))))) {
      throw new Error('invalid error judgment run row');
    }
  } else if (row.kind === 'skipped') {
    if (row.judgmentSha256 !== null
      || row.source !== null
      || row.requestSha256 !== null
      || row.choice !== null
      || row.probabilities !== null
      || row.providerConfidence !== null
      || row.errorCode !== null
      || row.reason !== 'live-question-budget'
      || !liveEligible) {
      throw new Error('invalid skipped judgment run row');
    }
  } else {
    throw new Error('invalid judgment run row kind');
  }
}

export function validateRelationalJudgmentRun(run, {
  batch = null,
  requestPlan = null,
  relationalCases = null,
  judgments = null,
  cacheEntries = null,
} = {}) {
  if (!run?.judgmentRunSha256) throw new TypeError('relational judgment run required');
  const { judgmentRunSha256, ...body } = clone(run);
  if (hashBody(body) !== judgmentRunSha256) throw new Error('relational judgment run hash mismatch');
  if (run.schemaVersion !== 3 || run.gate !== RELATIONAL_JUDGMENT_GATE || run.authority !== 'advisory') {
    throw new Error('unsupported relational judgment run version/authority');
  }
  if (!shaLike(run.batchSha256)
    || !shaLike(run.compositionInputSha256)
    || !shaLike(run.requestPlanSha256)) {
    throw new Error('invalid relational judgment run digest binding');
  }
  normalizeMaxLiveQuestions(run.maxLiveQuestions);
  if (run.questionId !== RELATION_DIRECTION_QUESTION.id
    || run.questionVersion !== RELATION_DIRECTION_QUESTION.version
    || !nonEmpty(run.provider)
    || !nonEmpty(run.model)) {
    throw new Error('invalid relational judgment run identity');
  }
  if (!Array.isArray(run.rows) || run.rows.length > 20) throw new Error('invalid judgment run rows');
  for (const row of run.rows) validateRunRow(row);

  const expectedCounts = runCounts(run.rows);
  if (stableJson(expectedCounts) !== stableJson(run.counts)) {
    throw new Error('relational judgment run count mismatch');
  }
  if (run.counts.live > run.maxLiveQuestions) {
    throw new Error('relational judgment live-question budget exceeded');
  }

  if (run.counts.skipped > 0) {
    const eligibleLiveOrSkipped = run.rows.filter((row) =>
      row.source === 'live' || row.kind === 'skipped').length;
    if (eligibleLiveOrSkipped <= run.maxLiveQuestions) {
      throw new Error('budget skip while live-question budget remained');
    }
  }
  let skippedSeen = false;
  for (const row of run.rows) {
    if (row.kind === 'skipped') skippedSeen = true;
    else if (row.source === 'live' && skippedSeen) {
      throw new Error('live question selected after a budget skip');
    }
  }

  const attemptedRows = run.rows.filter((row) => row.source === 'live' && shaLike(row.requestSha256));
  if (run.providerRequestCount !== attemptedRows.length
    || run.providerRequestCount > run.maxLiveQuestions) {
    throw new Error('provider request count mismatch');
  }

  if (requestPlan) {
    validateRelationalJudgmentRequestPlan(
      requestPlan,
      batch && relationalCases ? { batch, relationalCases } : {},
    );
    if (requestPlan.requestPlanSha256 !== run.requestPlanSha256
      || requestPlan.batchSha256 !== run.batchSha256
      || requestPlan.compositionInputSha256 !== run.compositionInputSha256
      || requestPlan.provider !== run.provider
      || requestPlan.model !== run.model) {
      throw new Error('judgment run request-plan mismatch');
    }
    if (requestPlan.rows.length !== run.rows.length) {
      throw new Error('judgment run row count does not match plan');
    }
    for (let index = 0; index < requestPlan.rows.length; index += 1) {
      if (requestPlan.rows[index].caseSha256 !== run.rows[index].caseSha256
        || requestPlan.rows[index].hypothesisId !== run.rows[index].hypothesisId) {
        throw new Error('judgment run row order mismatch');
      }
    }
  }

  if (batch) {
    if (batch.batchSha256 !== run.batchSha256
      || batch.compositionInputSha256 !== run.compositionInputSha256) {
      throw new Error('judgment run batch mismatch');
    }
  }

  const caseIndex = relationalCases ? exactCaseIndex(batch, relationalCases) : null;

  if (judgments) {
    const bySha = new Map();
    for (const judgment of judgments) {
      validateJevRelationalJudgment(judgment);
      if (bySha.has(judgment.judgmentSha256)) throw new Error('duplicate judgment artifact');
      bySha.set(judgment.judgmentSha256, judgment);
    }
    const expectedJudgmentRows = run.rows.filter((row) => row.judgmentSha256 != null);
    if (bySha.size !== expectedJudgmentRows.length) {
      throw new Error('judgment artifact set does not exactly match run');
    }
    for (const row of expectedJudgmentRows) {
      const judgment = bySha.get(row.judgmentSha256);
      if (!judgment) throw new Error(`missing judgment artifact: ${row.judgmentSha256}`);
      const relationalCase = caseIndex?.get(row.caseSha256) ?? null;
      validateJevRelationalJudgment(judgment, relationalCase ? { relationalCase } : {});
      if (judgment.caseSha256 !== row.caseSha256
        || judgment.provider !== run.provider
        || judgment.model !== run.model
        || judgment.status !== (row.kind === 'answered' ? 'answered' : 'error')) {
        throw new Error('judgment artifact row mismatch');
      }
      if (row.kind === 'answered'
        && (judgment.choice !== row.choice
          || judgment.providerConfidence !== row.providerConfidence)) {
        throw new Error('answered judgment row mismatch');
      }
      if (row.kind === 'error' && judgment.errorCode !== row.errorCode) {
        throw new Error('error judgment row mismatch');
      }
    }
  }

  if (cacheEntries) {
    const byJudgment = new Map();
    for (const entry of cacheEntries) {
      validateJevRelationalCacheEntry(entry, { provider: run.provider, model: run.model });
      if (byJudgment.has(entry.judgment.judgmentSha256)) throw new Error('duplicate cache entry');
      byJudgment.set(entry.judgment.judgmentSha256, entry);
    }
    const answeredRows = run.rows.filter((row) => row.kind === 'answered');
    if (byJudgment.size !== answeredRows.length) {
      throw new Error('cache entry set does not exactly match answered rows');
    }
    for (const row of answeredRows) {
      const entry = byJudgment.get(row.judgmentSha256);
      if (!entry || stableJson(entry.probabilities) !== stableJson(row.probabilities)) {
        throw new Error('answered row probability mismatch');
      }
      if (row.source === 'live' && entry.requestSha256 !== row.requestSha256) {
        throw new Error('live cache entry is not bound to row request');
      }
    }
  }

  return run;
}
