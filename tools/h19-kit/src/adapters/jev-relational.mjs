import { createHash } from 'node:crypto';

import { cacheKey, stableJson } from '../core/cache.mjs';
import {
  RELATION_DIRECTION_QUESTION,
  freezeJevRelationalJudgment,
  relationalInputDigest,
  relationalJevState,
  validateJevRelationalJudgment,
  validateRelationalEvidenceCase,
} from '../relations/relational-evidence.mjs';

export const JEV_RELATIONAL_MODEL = 'jev-1.13.0';
export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
const CACHE_NAMESPACE = 'jev-relational-v0.1';
export const JEV_RELATIONAL_CACHE_NAMESPACE = CACHE_NAMESPACE;

export const RELATION_CHOICE_DOMAIN = Object.freeze(Object.keys(RELATION_DIRECTION_QUESTION.criteria));
export const PROBABILITY_SUM_TOLERANCE = 0.02;
const CACHE_ENTRY_KIND = 'jev-relational-cache-entry';
export const JEV_RELATIONAL_CACHE_SCHEMA = 3;
export const JEV_RELATIONAL_EXECUTION_SHAPE = 'single-case';

const hashBody = (value) => createHash('sha256').update(`${stableJson(value)}\n`).digest('hex');
const shaLike = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function relationalTransportErrorCode(error) {
  const name = String(error?.name ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  if (name.includes('timeout') || name.includes('abort') || message.includes('timeout')) return 'timeout';
  return 'transport_error';
}

export function normalizeRelationProbabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== RELATION_CHOICE_DOMAIN.length
    || !RELATION_CHOICE_DOMAIN.every((choice) => keys.includes(choice))) return null;
  let sum = 0;
  const out = {};
  for (const choice of RELATION_CHOICE_DOMAIN) {
    const p = value[choice];
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
    out[choice] = p;
    sum += p;
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return null;
  return out;
}

export function freezeJevRelationalCacheEntry({
  judgment,
  probabilities,
  requestSha256,
  executionShape = JEV_RELATIONAL_EXECUTION_SHAPE,
} = {}) {
  validateJevRelationalJudgment(judgment);
  if (judgment.status !== 'answered') throw new Error('only answered judgments are cached');
  const normalized = normalizeRelationProbabilities(probabilities);
  if (!normalized) throw new Error('invalid relation probability distribution');
  if (!shaLike(requestSha256)) throw new Error('single-case cache entry requires request digest');
  if (executionShape !== JEV_RELATIONAL_EXECUTION_SHAPE) {
    throw new Error('v0.3 cache entry execution shape must be single-case');
  }
  const body = {
    schemaVersion: JEV_RELATIONAL_CACHE_SCHEMA,
    kind: CACHE_ENTRY_KIND,
    executionShape,
    judgment: structuredClone(judgment),
    probabilities: normalized,
    requestSha256,
  };
  return deepFreeze({ ...body, entrySha256: hashBody(body) });
}

export function validateJevRelationalCacheEntry(entry, {
  relationalCase = null,
  provider = null,
  model = null,
} = {}) {
  if (!entry
    || entry.kind !== CACHE_ENTRY_KIND
    || entry.schemaVersion !== JEV_RELATIONAL_CACHE_SCHEMA
    || entry.executionShape !== JEV_RELATIONAL_EXECUTION_SHAPE) {
    throw new Error('not a v0.3 single-case relational cache entry');
  }
  const { entrySha256, ...body } = structuredClone(entry);
  if (hashBody(body) !== entrySha256) throw new Error('relational cache entry hash mismatch');
  validateJevRelationalJudgment(entry.judgment, relationalCase ? { relationalCase } : {});
  if (entry.judgment.status !== 'answered') throw new Error('cached judgment must be answered');
  if ((provider && entry.judgment.provider !== provider) || (model && entry.judgment.model !== model)) {
    throw new Error('cached Jev judgment identity mismatch');
  }
  const normalized = normalizeRelationProbabilities(entry.probabilities);
  if (!normalized || stableJson(normalized) !== stableJson(entry.probabilities)) {
    throw new Error('invalid cached relation probability distribution');
  }
  if (!shaLike(entry.requestSha256)) throw new Error('invalid cached request digest');
  if (relationalCase) {
    const expectedRequest = buildJevRelationalSingleCaseRequest({
      relationalCase,
      model: entry.judgment.model,
    });
    if (entry.requestSha256 !== jevRelationalRequestSha256(expectedRequest)) {
      throw new Error('cached request digest does not match the exact single-case request');
    }
  }
  return entry;
}

function validateLegacyV02CacheEntry(entry, { relationalCase, provider, model }) {
  if (!entry || entry.kind !== CACHE_ENTRY_KIND || entry.schemaVersion !== 2) {
    throw new Error('not a v0.2 relational cache entry');
  }
  const { entrySha256, ...body } = structuredClone(entry);
  if (hashBody(body) !== entrySha256) throw new Error('legacy cache entry hash mismatch');
  validateJevRelationalJudgment(entry.judgment, { relationalCase });
  if (entry.judgment.status !== 'answered'
    || entry.judgment.provider !== provider
    || entry.judgment.model !== model) {
    throw new Error('legacy cache identity mismatch');
  }
  if (!normalizeRelationProbabilities(entry.probabilities)) {
    throw new Error('invalid legacy probability distribution');
  }
  if (entry.requestSha256 !== null && !shaLike(entry.requestSha256)) {
    throw new Error('invalid legacy request digest');
  }
  return entry;
}

// v0.3 replay classification:
// hit              -> exact v0.3 single-case entry
// upgrade-required -> valid legacy judgment-only or v0.2 fan-out entry
// invalid          -> tampered/identity-invalid/unknown content under exact key
export function classifyJevRelationalCacheValue(value, { relationalCase, provider, model }) {
  if (value == null) return { status: 'miss' };
  try {
    if (value.kind === CACHE_ENTRY_KIND && value.schemaVersion === JEV_RELATIONAL_CACHE_SCHEMA) {
      return {
        status: 'hit',
        entry: validateJevRelationalCacheEntry(value, { relationalCase, provider, model }),
      };
    }
    if (value.kind === CACHE_ENTRY_KIND && value.schemaVersion === 2) {
      validateLegacyV02CacheEntry(value, { relationalCase, provider, model });
      return { status: 'upgrade-required' };
    }
    validateJevRelationalJudgment(value, { relationalCase });
    if (value.status === 'answered' && value.provider === provider && value.model === model) {
      return { status: 'upgrade-required' };
    }
  } catch {
    return { status: 'invalid' };
  }
  return { status: 'invalid' };
}

export function jevRelationalCacheKey({
  relationalCase,
  provider = 'typesafe',
  model = JEV_RELATIONAL_MODEL,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  return cacheKey(CACHE_NAMESPACE, {
    provider,
    model,
    questionId: RELATION_DIRECTION_QUESTION.id,
    questionVersion: RELATION_DIRECTION_QUESTION.version,
    inputSha256: relationalInputDigest(relationalCase),
  });
}

export function jevRelationalProviderQuestion() {
  return {
    type: RELATION_DIRECTION_QUESTION.type,
    instructions: RELATION_DIRECTION_QUESTION.instructions,
    criteria: structuredClone(RELATION_DIRECTION_QUESTION.criteria),
  };
}

export function buildJevRelationalSingleCaseRequest({
  relationalCase,
  model = JEV_RELATIONAL_MODEL,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  if (!nonEmpty(model)) throw new TypeError('model required');
  return deepFreeze({
    model,
    state: structuredClone(relationalJevState(relationalCase)),
    questions: {
      relation: jevRelationalProviderQuestion(),
    },
  });
}

export function jevRelationalRequestSha256(request) {
  return hashBody(request);
}

// Strict v0.3 transport acceptance. This is intentionally stricter than the
// legacy M8 adapter so M8's historical contract remains backward-compatible.
export function acceptJevRelationalSingleCaseResponse(json, { model = JEV_RELATIONAL_MODEL } = {}) {
  if (!json || typeof json !== 'object') return { errorCode: 'invalid_response' };
  if (json.model !== model) return { errorCode: 'model_mismatch' };
  const answers = json.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { errorCode: 'invalid_response' };
  }
  const ids = Object.keys(answers);
  if (ids.length !== 1 || ids[0] !== 'relation') return { errorCode: 'answer_set_mismatch' };
  const answer = answers.relation;
  const probabilities = normalizeRelationProbabilities(answer?.probabilities);
  if (!answer
    || typeof answer !== 'object'
    || answer.type !== 'choice'
    || !RELATION_CHOICE_DOMAIN.includes(answer.choice)
    || typeof answer.confidence !== 'number'
    || !Number.isFinite(answer.confidence)
    || answer.confidence < 0
    || answer.confidence > 1
    || !probabilities) {
    return { errorCode: 'invalid_answer' };
  }
  return {
    answer: {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities,
    },
  };
}

export async function askJevRelationalDirection({
  relationalCase,
  apiKey,
  model = JEV_RELATIONAL_MODEL,
  fetchImpl = fetch,
  cache = null,
  timeoutMs = 8_000,
} = {}) {
  validateRelationalEvidenceCase(relationalCase);
  if (!nonEmpty(model)) throw new TypeError('model required');

  const provider = 'typesafe';
  const inputSha256 = relationalInputDigest(relationalCase);
  const key = jevRelationalCacheKey({ relationalCase, provider, model });

  // Preserve the original M8 replay behavior, including legacy judgment-only
  // entries created by this adapter.
  if (cache?.get) {
    let cached = await cache.get(CACHE_NAMESPACE, key);
    if (cached?.kind === CACHE_ENTRY_KIND) {
      if (cached.schemaVersion === JEV_RELATIONAL_CACHE_SCHEMA) {
        cached = validateJevRelationalCacheEntry(cached, { relationalCase, provider, model }).judgment;
      } else if (cached.schemaVersion === 2) {
        cached = validateLegacyV02CacheEntry(cached, { relationalCase, provider, model }).judgment;
      }
    }
    if (cached) {
      validateJevRelationalJudgment(cached, { relationalCase });
      if (cached.model !== model || cached.provider !== provider) {
        throw new Error('cached Jev judgment identity mismatch');
      }
      return Object.freeze({ judgment: cached, cached: true, cacheKey: key });
    }
  }

  if (!nonEmpty(apiKey)) {
    return Object.freeze({
      judgment: freezeJevRelationalJudgment({
        relationalCase,
        provider,
        model,
        errorCode: 'missing_api_key',
        inputSha256,
      }),
      cached: false,
      cacheKey: key,
    });
  }

  try {
    const request = buildJevRelationalSingleCaseRequest({ relationalCase, model });
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

    const response = await fetchImpl(TYPESAFE_SYSTEMONE_URL, options);
    if (!response?.ok) {
      const status = Number.isInteger(response?.status) ? response.status : 0;
      return Object.freeze({
        judgment: freezeJevRelationalJudgment({
          relationalCase,
          provider,
          model,
          errorCode: `http_${status}`,
          inputSha256,
        }),
        cached: false,
        cacheKey: key,
      });
    }

    const json = await response.json();
    const answer = json?.answers?.relation;
    if (!answer || typeof answer !== 'object') {
      return Object.freeze({
        judgment: freezeJevRelationalJudgment({
          relationalCase,
          provider,
          model,
          errorCode: 'invalid_response',
          inputSha256,
        }),
        cached: false,
        cacheKey: key,
      });
    }

    const judgment = freezeJevRelationalJudgment({
      relationalCase,
      provider,
      model,
      answer: {
        choice: answer.choice,
        confidence: answer.confidence,
      },
      inputSha256,
    });

    if (cache?.set) await cache.set(CACHE_NAMESPACE, key, judgment);

    return Object.freeze({ judgment, cached: false, cacheKey: key });
  } catch (error) {
    return Object.freeze({
      judgment: freezeJevRelationalJudgment({
        relationalCase,
        provider,
        model,
        errorCode: relationalTransportErrorCode(error),
        inputSha256,
      }),
      cached: false,
      cacheKey: key,
    });
  }
}
