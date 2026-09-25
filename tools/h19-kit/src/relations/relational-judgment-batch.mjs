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
  JEV_RELATIONAL_MODEL,
  askJevRelationalDirection,
  jevRelationalCacheKey,
} from '../adapters/jev-relational.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const hashBody = (value) => sha256(`${stableJson(value)}\n`);

export const RELATIONAL_JUDGMENT_BATCH_MAX_LIVE_CALLS = 20;

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

function normalizeMaxLiveCalls(value) {
  if (!Number.isInteger(value)
    || value < 0
    || value > RELATIONAL_JUDGMENT_BATCH_MAX_LIVE_CALLS) {
    throw new TypeError('maxLiveCalls must be an integer between 0 and 20');
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
    if (!relationalCase) {
      throw new Error(`missing relational case artifact: ${summary.caseSha256}`);
    }
    if (relationalCase.hypothesis.hypothesisId !== summary.hypothesisId) {
      throw new Error('relational case hypothesis binding mismatch');
    }
  }

  return bySha;
}

function freezeRequestPlan(body) {
  return deepFreeze({
    ...body,
    requestPlanSha256: hashBody(body),
  });
}

export function buildRelationalJudgmentRequestPlan({
  batch,
  relationalCases,
  provider = 'typesafe',
  model = JEV_RELATIONAL_MODEL,
} = {}) {
  if (!nonEmpty(provider) || !nonEmpty(model)) {
    throw new TypeError('provider and model required');
  }
  if (provider !== 'typesafe') {
    throw new Error(`unsupported relational judgment provider: ${provider}`);
  }

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
  return deepFreeze({
    ...body,
    judgmentRunSha256: hashBody(body),
  });
}

function runCounts(rows) {
  return deepFreeze({
    cached: rows.filter((row) => row.source === 'cache').length,
    live: rows.filter((row) => row.source === 'live').length,
    answered: rows.filter((row) => row.kind === 'answered').length,
    insufficient: rows.filter((row) => row.kind === 'answered' && row.choice === 'insufficient').length,
    error: rows.filter((row) => row.kind === 'error').length,
    skipped: rows.filter((row) => row.kind === 'skipped').length,
  });
}

function judgmentRow({ planRow, judgment, source }) {
  validateJevRelationalJudgment(judgment);
  if (judgment.caseSha256 !== planRow.caseSha256
    || judgment.inputSha256 !== planRow.inputSha256
    || judgment.provider !== planRow.provider
    || judgment.model !== planRow.model
    || judgment.questionId !== planRow.questionId
    || judgment.questionVersion !== planRow.questionVersion) {
    throw new Error('judgment does not match planned request identity');
  }

  if (judgment.status === 'answered') {
    return deepFreeze({
      kind: 'answered',
      hypothesisId: planRow.hypothesisId,
      caseSha256: planRow.caseSha256,
      judgmentSha256: judgment.judgmentSha256,
      source,
      choice: judgment.choice,
      providerConfidence: judgment.providerConfidence,
      errorCode: null,
      reason: null,
    });
  }

  return deepFreeze({
    kind: 'error',
    hypothesisId: planRow.hypothesisId,
    caseSha256: planRow.caseSha256,
    judgmentSha256: judgment.judgmentSha256,
    source,
    choice: null,
    providerConfidence: null,
    errorCode: judgment.errorCode,
    reason: null,
  });
}

function budgetSkipRow(planRow) {
  return deepFreeze({
    kind: 'skipped',
    hypothesisId: planRow.hypothesisId,
    caseSha256: planRow.caseSha256,
    judgmentSha256: null,
    source: null,
    choice: null,
    providerConfidence: null,
    errorCode: null,
    reason: 'live-call-budget',
  });
}

function cacheInvalidJudgment(relationalCase, planRow) {
  return freezeJevRelationalJudgment({
    relationalCase,
    provider: planRow.provider,
    model: planRow.model,
    errorCode: 'invalid_cache',
    inputSha256: planRow.inputSha256,
  });
}

export async function runRelationalJudgmentBatch({
  batch,
  relationalCases,
  provider = 'typesafe',
  model = JEV_RELATIONAL_MODEL,
  maxLiveCalls = RELATIONAL_JUDGMENT_BATCH_MAX_LIVE_CALLS,
  apiKey = '',
  cache = null,
  fetchImpl = fetch,
  timeoutMs = 8_000,
} = {}) {
  const boundedLiveCalls = normalizeMaxLiveCalls(maxLiveCalls);
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
  const rows = [];
  const judgments = [];
  let liveSlotsUsed = 0;

  for (const planRow of requestPlan.rows) {
    const relationalCase = bySha.get(planRow.caseSha256);

    let probe;
    try {
      probe = await askJevRelationalDirection({
        relationalCase,
        apiKey: '',
        model,
        fetchImpl: async () => {
          throw new Error('cache probe attempted provider access');
        },
        cache,
        timeoutMs,
      });
    } catch {
      const judgment = cacheInvalidJudgment(relationalCase, planRow);
      judgments.push(judgment);
      rows.push(judgmentRow({ planRow, judgment, source: 'cache' }));
      continue;
    }

    if (probe.cached) {
      validateJevRelationalJudgment(probe.judgment, { relationalCase });
      judgments.push(probe.judgment);
      rows.push(judgmentRow({ planRow, judgment: probe.judgment, source: 'cache' }));
      continue;
    }

    if (liveSlotsUsed >= boundedLiveCalls) {
      rows.push(budgetSkipRow(planRow));
      continue;
    }

    liveSlotsUsed += 1;
    const result = await askJevRelationalDirection({
      relationalCase,
      apiKey,
      model,
      fetchImpl,
      cache,
      timeoutMs,
    });

    validateJevRelationalJudgment(result.judgment, { relationalCase });
    judgments.push(result.judgment);
    rows.push(judgmentRow({
      planRow,
      judgment: result.judgment,
      source: result.cached ? 'cache' : 'live',
    }));
    if (result.cached) liveSlotsUsed -= 1;
  }

  if (stableJson(relationalCases) !== sourceCasesBefore || stableJson(batch) !== sourceBatchBefore) {
    throw new Error('relational judgment batch mutated source artifacts');
  }

  const counts = runCounts(rows);
  const run = freezeRun({
    schemaVersion: 1,
    authority: 'advisory',
    batchSha256: batch.batchSha256,
    compositionInputSha256: batch.compositionInputSha256,
    requestPlanSha256: requestPlan.requestPlanSha256,
    provider,
    model,
    questionId: RELATION_DIRECTION_QUESTION.id,
    questionVersion: RELATION_DIRECTION_QUESTION.version,
    maxLiveCalls: boundedLiveCalls,
    rows,
    counts,
  });

  return deepFreeze({
    requestPlan,
    run,
    judgments,
  });
}

export function validateRelationalJudgmentRun(run, {
  batch = null,
  requestPlan = null,
  relationalCases = null,
  judgments = null,
} = {}) {
  if (!run?.judgmentRunSha256) throw new TypeError('relational judgment run required');
  const { judgmentRunSha256, ...body } = clone(run);
  if (hashBody(body) !== judgmentRunSha256) throw new Error('relational judgment run hash mismatch');
  if (run.schemaVersion !== 1 || run.authority !== 'advisory') {
    throw new Error('unsupported relational judgment run version/authority');
  }
  if (!shaLike(run.batchSha256)
    || !shaLike(run.compositionInputSha256)
    || !shaLike(run.requestPlanSha256)) {
    throw new Error('invalid relational judgment run digest binding');
  }
  normalizeMaxLiveCalls(run.maxLiveCalls);
  if (run.questionId !== RELATION_DIRECTION_QUESTION.id
    || run.questionVersion !== RELATION_DIRECTION_QUESTION.version
    || !nonEmpty(run.provider)
    || !nonEmpty(run.model)) {
    throw new Error('invalid relational judgment run identity');
  }
  if (!Array.isArray(run.rows) || run.rows.length > 20) throw new Error('invalid judgment run rows');

  for (const row of run.rows) {
    if (!nonEmpty(row.hypothesisId) || !shaLike(row.caseSha256)) throw new Error('invalid judgment run row binding');
    if (row.kind === 'answered') {
      if (!shaLike(row.judgmentSha256)
        || !['cache', 'live'].includes(row.source)
        || !['strengthens', 'weakens', 'unrelated', 'insufficient'].includes(row.choice)
        || typeof row.providerConfidence !== 'number'
        || row.providerConfidence < 0
        || row.providerConfidence > 1
        || row.errorCode !== null
        || row.reason !== null) {
        throw new Error('invalid answered judgment run row');
      }
    } else if (row.kind === 'error') {
      if (!shaLike(row.judgmentSha256)
        || !['cache', 'live'].includes(row.source)
        || row.choice !== null
        || row.providerConfidence !== null
        || !nonEmpty(row.errorCode)
        || row.reason !== null) {
        throw new Error('invalid error judgment run row');
      }
    } else if (row.kind === 'skipped') {
      if (row.judgmentSha256 !== null
        || row.source !== null
        || row.choice !== null
        || row.providerConfidence !== null
        || row.errorCode !== null
        || row.reason !== 'live-call-budget') {
        throw new Error('invalid skipped judgment run row');
      }
    } else {
      throw new Error('invalid judgment run row kind');
    }
  }

  const expectedCounts = runCounts(run.rows);
  if (stableJson(expectedCounts) !== stableJson(run.counts)) {
    throw new Error('relational judgment run count mismatch');
  }
  if (run.counts.live > run.maxLiveCalls) throw new Error('relational judgment live-call budget exceeded');

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
    if (requestPlan.rows.length !== run.rows.length) throw new Error('judgment run row count does not match plan');
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

    const caseIndex = relationalCases
      ? exactCaseIndex(batch, relationalCases)
      : null;

    for (const row of expectedJudgmentRows) {
      const judgment = bySha.get(row.judgmentSha256);
      if (!judgment) throw new Error(`missing judgment artifact: ${row.judgmentSha256}`);
      const relationalCase = caseIndex?.get(row.caseSha256) ?? null;
      validateJevRelationalJudgment(
        judgment,
        relationalCase ? { relationalCase } : {},
      );
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

  return run;
}
