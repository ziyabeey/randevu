import { cacheKey } from '../core/cache.mjs';
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

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorCodeFor(error) {
  const name = String(error?.name ?? '').toLowerCase();
  const message = String(error?.message ?? '').toLowerCase();
  if (name.includes('timeout') || name.includes('abort') || message.includes('timeout')) return 'timeout';
  return 'transport_error';
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

function providerQuestion() {
  return {
    type: RELATION_DIRECTION_QUESTION.type,
    instructions: RELATION_DIRECTION_QUESTION.instructions,
    criteria: structuredClone(RELATION_DIRECTION_QUESTION.criteria),
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

  if (cache?.get) {
    const cached = await cache.get(CACHE_NAMESPACE, key);
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
    const options = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        state: relationalJevState(relationalCase),
        questions: {
          relation: providerQuestion(),
        },
      }),
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
        errorCode: errorCodeFor(error),
        inputSha256,
      }),
      cached: false,
      cacheKey: key,
    });
  }
}
