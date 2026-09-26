import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { stableJson } from '../src/core/cache.mjs';
import { composeRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';
import { freezeJevRelationalJudgment } from '../src/relations/relational-evidence.mjs';
import {
  JEV_RELATIONAL_CACHE_NAMESPACE,
  JEV_RELATIONAL_MODEL,
  buildJevRelationalSingleCaseRequest,
  freezeJevRelationalCacheEntry,
  jevRelationalCacheKey,
  jevRelationalRequestSha256,
  validateJevRelationalCacheEntry,
} from '../src/adapters/jev-relational.mjs';
import {
  RELATIONAL_JUDGMENT_GATE,
  buildRelationalJudgmentRequestPlan,
  runRelationalJudgmentBatch,
  validateRelationalJudgmentRequestPlan,
  validateRelationalJudgmentRun,
} from '../src/relations/relational-judgment-batch.mjs';

const hashBody = (value) => createHash('sha256').update(`${stableJson(value)}\n`).digest('hex');

function hypothesis(index) {
  return {
    id: `coverage:surviving-mutant:m${index}:src/f${index}.ts`,
    target: { kind: 'path', path: `src/f${index}.ts` },
    reason: 'surviving-mutant',
    priority: 'high',
    evidenceIds: [`evidence:${index}`],
    validation: {
      preferred: 'targeted-test-or-mutation',
      requiresRuntimeEvidence: true,
    },
  };
}

function fact({ factId, family, path, value = 1 }) {
  return {
    fact: {
      factId,
      family,
      state: 'present',
      metricId: `metric:${family}`,
      value,
      unit: 'count',
      denominator: null,
      sampleSize: 10,
      baseline: {
        value: 0.5,
        sampleSize: 100,
        sourceId: `baseline:${family}`,
      },
      lineageIds: [`lineage:${factId}`],
      provenance: {
        producer: `producer:${family}`,
        producerVersion: '1',
        inputDigest: `input:${factId}`,
        sourceRevision: 'rev-1',
        evidenceIds: [`evidence:${factId}`],
      },
    },
    scope: { kind: 'path', path },
  };
}

const hypotheses = Array.from({ length: 6 }, (_, index) => hypothesis(index));
const packet = freezeCoverageDiscoveryPacket({
  changeId: 'change-m10-v03',
  sourceRevision: 'rev-1',
  impact: {
    changedFiles: hypotheses.map((item) => item.target.path),
    unknowns: [],
    safeToNarrow: true,
  },
  discovery: { hypotheses },
});

const factPool = hypotheses.flatMap((item, index) => [
  fact({ factId: `mutation:${index}`, family: 'mutation', path: item.target.path, value: index + 1 }),
  fact({ factId: `coverage:${index}`, family: 'coverage', path: item.target.path, value: index + 2 }),
]);

const composed = composeRelationalCaseBatch({ packet, factPool });
const { batch, relationalCases } = composed;
assert.equal(batch.cases.length, 6);
const byOrder = batch.cases.map((summary) =>
  relationalCases.find((item) => item.caseSha256 === summary.caseSha256));

// JS1/JS2 exact binding + deterministic plan.
const planA = buildRelationalJudgmentRequestPlan({ batch, relationalCases });
const planB = buildRelationalJudgmentRequestPlan({
  batch,
  relationalCases: [...relationalCases].reverse(),
});
assert.equal(planA.requestPlanSha256, planB.requestPlanSha256);
assert.deepEqual(planA.rows.map((row) => row.caseSha256), batch.cases.map((row) => row.caseSha256));
assert.equal(validateRelationalJudgmentRequestPlan(planA, { batch, relationalCases }), planA);
let bindingFetches = 0;
await assert.rejects(() => runRelationalJudgmentBatch({
  batch,
  relationalCases: relationalCases.slice(0, 5),
  apiKey: 'k',
  fetchImpl: async () => {
    bindingFetches += 1;
    throw new Error('must not reach provider');
  },
}), /artifact count|exactly match|missing relational case/);
assert.equal(bindingFetches, 0);

class MemoryCache {
  constructor() {
    this.map = new Map();
    this.writes = 0;
  }

  async get(_namespace, key) {
    return this.map.get(key) ?? null;
  }

  async set(namespace, key, value) {
    assert.equal(namespace, JEV_RELATIONAL_CACHE_NAMESPACE);
    this.writes += 1;
    this.map.set(key, structuredClone(value));
  }

  snapshot() {
    return JSON.stringify([...this.map.entries()]);
  }
}

const keyOf = (relationalCase) => jevRelationalCacheKey({
  relationalCase,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
});
const judgmentFor = (relationalCase, choice, confidence, model = JEV_RELATIONAL_MODEL) =>
  freezeJevRelationalJudgment({
    relationalCase,
    provider: 'typesafe',
    model,
    answer: { choice, confidence },
  });
const dist = (strengthens, weakens, unrelated, insufficient) => ({
  strengthens,
  weakens,
  unrelated,
  insufficient,
});

function v03Entry(relationalCase, choice, confidence, probabilities) {
  const request = buildJevRelationalSingleCaseRequest({
    relationalCase,
    model: JEV_RELATIONAL_MODEL,
  });
  return freezeJevRelationalCacheEntry({
    judgment: judgmentFor(relationalCase, choice, confidence),
    probabilities,
    requestSha256: jevRelationalRequestSha256(request),
  });
}

function legacyV02Entry(relationalCase, choice, confidence, probabilities) {
  const body = {
    schemaVersion: 2,
    kind: 'jev-relational-cache-entry',
    judgment: structuredClone(judgmentFor(relationalCase, choice, confidence)),
    probabilities,
    requestSha256: 'a'.repeat(64),
  };
  return { ...body, entrySha256: hashBody(body) };
}

function seededCache() {
  const cache = new MemoryCache();
  // Exact v0.3 replay hit.
  cache.map.set(keyOf(byOrder[0]), structuredClone(v03Entry(
    byOrder[0],
    'strengthens',
    0.82,
    dist(0.84, 0.06, 0.07, 0.03),
  )));
  // v0.1 judgment-only: upgrade-required.
  cache.map.set(keyOf(byOrder[1]), structuredClone(
    judgmentFor(byOrder[1], 'weakens', 0.7),
  ));
  // v0.2 fan-out entry: upgrade-required.
  cache.map.set(keyOf(byOrder[2]), structuredClone(legacyV02Entry(
    byOrder[2],
    'unrelated',
    0.61,
    dist(0.1, 0.1, 0.65, 0.15),
  )));
  // Tampered exact-key content: invalid, never live fallback.
  const tampered = structuredClone(v03Entry(
    byOrder[3],
    'strengthens',
    0.7,
    dist(0.7, 0.1, 0.1, 0.1),
  ));
  tampered.probabilities.strengthens = 0.6;
  cache.map.set(keyOf(byOrder[3]), tampered);
  return cache;
}

const answer = (choice, confidence, probabilities) => ({
  type: 'choice',
  choice,
  confidence,
  probabilities,
});
const okJson = (json) => ({
  ok: true,
  status: 200,
  async json() {
    return json;
  },
});

const secret = 'super-secret-jev-key';

// JS3–JS8/JS11–JS13/JS15/JS17/JS20:
// cache first, legacy upgrades, invalid cache isolation, deterministic budget,
// separate single-case bodies and true concurrency.
const cache = seededCache();
let calls = 0;
let inFlight = 0;
let maxInFlight = 0;
const bodies = [];
const concurrentFetch = async (_url, options) => {
  calls += 1;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const body = JSON.parse(options.body);
  bodies.push(body);
  assert.equal(body.model, JEV_RELATIONAL_MODEL);
  assert.deepEqual(Object.keys(body.questions), ['relation']);
  assert.equal(body.questions.relation.type, 'choice');
  assert.equal(typeof body.state.hypothesis.hypothesisId, 'string');
  assert.doesNotMatch(options.body, new RegExp(secret));
  await new Promise((resolve) => setTimeout(resolve, 15));
  inFlight -= 1;

  const index = Number(body.state.hypothesis.hypothesisId.match(/:m(\d+):/)?.[1] ?? 0);
  const payload = index === 1
    ? answer('insufficient', 0.62, dist(0.1, 0.1, 0.18, 0.62))
    : answer('strengthens', 0.78, dist(0.8, 0.05, 0.1, 0.05));
  return okJson({
    model: JEV_RELATIONAL_MODEL,
    answers: { relation: payload },
  });
};

const batchBefore = JSON.stringify(batch);
const casesBefore = JSON.stringify(relationalCases);
const firstRun = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 2,
  apiKey: secret,
  cache,
  fetchImpl: concurrentFetch,
});

assert.equal(calls, 2);
assert.ok(maxInFlight >= 2, 'selected single-case requests must overlap in flight');
assert.equal(bodies.length, 2);
assert.notEqual(
  bodies[0].state.hypothesis.hypothesisId,
  bodies[1].state.hypothesis.hypothesisId,
);
for (const body of bodies) {
  assert.equal(Object.hasOwn(body.state, 'cases'), false);
}

const rows = firstRun.run.rows;
assert.equal(firstRun.run.schemaVersion, 3);
assert.equal(firstRun.run.gate, RELATIONAL_JUDGMENT_GATE);
assert.equal(firstRun.run.providerRequestCount, 2);
assert.equal(rows[0].source, 'cache');
assert.equal(rows[0].cacheStatus, 'hit');
assert.equal(rows[0].requestSha256, null);
assert.equal(rows[1].source, 'live');
assert.equal(rows[1].cacheStatus, 'upgrade-required');
assert.equal(rows[1].choice, 'insufficient');
assert.match(rows[1].requestSha256, /^[a-f0-9]{64}$/);
assert.equal(rows[2].source, 'live');
assert.equal(rows[2].cacheStatus, 'upgrade-required');
assert.equal(rows[2].choice, 'strengthens');
assert.equal(rows[3].kind, 'error');
assert.equal(rows[3].source, 'cache');
assert.equal(rows[3].errorCode, 'invalid_cache');
assert.equal(rows[3].requestSha256, null);
for (const index of [4, 5]) {
  assert.equal(rows[index].kind, 'skipped');
  assert.equal(rows[index].reason, 'live-question-budget');
}
assert.deepEqual(firstRun.run.counts, {
  cached: 1,
  live: 2,
  answered: 3,
  insufficient: 1,
  error: 1,
  skipped: 2,
});
assert.equal(cache.writes, 2);
assert.equal(JSON.stringify(batch), batchBefore);
assert.equal(JSON.stringify(relationalCases), casesBefore);
assert.doesNotMatch(JSON.stringify(firstRun), new RegExp(secret));
assert.doesNotMatch(cache.snapshot(), new RegExp(secret));
assert.equal(validateRelationalJudgmentRun(firstRun.run, {
  batch,
  requestPlan: firstRun.requestPlan,
  relationalCases,
  judgments: firstRun.judgments,
  cacheEntries: firstRun.cacheEntries,
}), firstRun.run);

// JS9/JS14: one malformed/failed single request does not poison successful siblings.
const isolatedCache = new MemoryCache();
let isolatedCalls = 0;
const isolatedFetch = async (_url, options) => {
  isolatedCalls += 1;
  const body = JSON.parse(options.body);
  const index = Number(body.state.hypothesis.hypothesisId.match(/:m(\d+):/)?.[1] ?? 0);
  await new Promise((resolve) => setTimeout(resolve, index % 2 ? 3 : 10));
  if (index === 1) return { ok: false, status: 503 };
  if (index === 2) {
    return okJson({
      model: JEV_RELATIONAL_MODEL,
      answers: {
        wrong: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)),
      },
    });
  }
  return okJson({
    model: JEV_RELATIONAL_MODEL,
    answers: {
      relation: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)),
    },
  });
};
const isolatedRun = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 4,
  apiKey: secret,
  cache: isolatedCache,
  fetchImpl: isolatedFetch,
});
assert.equal(isolatedCalls, 4);
assert.equal(isolatedRun.run.providerRequestCount, 4);
assert.equal(isolatedRun.run.rows[0].kind, 'answered');
assert.equal(isolatedRun.run.rows[1].errorCode, 'http_503');
assert.equal(isolatedRun.run.rows[2].errorCode, 'answer_set_mismatch');
assert.equal(isolatedRun.run.rows[3].kind, 'answered');
assert.equal(isolatedCache.writes, 2, 'only successful sibling requests enter cache');

// JS17: response arrival order cannot change scientific run identity.
const makeDelayFetch = (reverse = false) => async (_url, options) => {
  const body = JSON.parse(options.body);
  const index = Number(body.state.hypothesis.hypothesisId.match(/:m(\d+):/)?.[1] ?? 0);
  const delay = reverse ? (20 - index * 2) : (index * 2);
  await new Promise((resolve) => setTimeout(resolve, Math.max(1, delay)));
  return okJson({
    model: JEV_RELATIONAL_MODEL,
    answers: {
      relation: answer('unrelated', 0.55, dist(0.2, 0.1, 0.57, 0.13)),
    },
  });
};
const orderA = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 3,
  apiKey: secret,
  cache: new MemoryCache(),
  fetchImpl: makeDelayFetch(false),
});
const orderB = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 3,
  apiKey: secret,
  cache: new MemoryCache(),
  fetchImpl: makeDelayFetch(true),
});
assert.equal(orderA.run.judgmentRunSha256, orderB.run.judgmentRunSha256);

// JS4: valid legacy entries upgrade, identity/tamper stays invalid with no live fallback.
assert.equal(firstRun.run.rows[1].cacheStatus, 'upgrade-required');
assert.equal(firstRun.run.rows[2].cacheStatus, 'upgrade-required');
assert.equal(firstRun.run.rows[3].cacheStatus, 'invalid');

// JS7/JS14: missing key attempts no provider request and records no request digest.
let missingKeyFetches = 0;
const missingKeyRun = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 2,
  apiKey: '',
  cache: new MemoryCache(),
  fetchImpl: async () => {
    missingKeyFetches += 1;
    throw new Error('missing key must not reach provider');
  },
});
assert.equal(missingKeyFetches, 0);
assert.equal(missingKeyRun.run.providerRequestCount, 0);
assert.equal(missingKeyRun.run.rows[0].errorCode, 'missing_api_key');
assert.equal(missingKeyRun.run.rows[0].requestSha256, null);

// JS10/JS11: malformed probability/choice domain fails only its request.
const badProbabilityRun = await runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveQuestions: 1,
  apiKey: secret,
  cache: new MemoryCache(),
  fetchImpl: async () => okJson({
    model: JEV_RELATIONAL_MODEL,
    answers: {
      relation: answer('strengthens', 0.8, {
        strengthens: 0.8,
        weakens: 0.1,
        unrelated: 0.1,
      }),
    },
  }),
});
assert.equal(badProbabilityRun.run.rows[0].errorCode, 'invalid_answer');

// Fully v0.3-cached replay: zero provider work.
const fullCache = new MemoryCache();
for (const relationalCase of byOrder) {
  fullCache.map.set(keyOf(relationalCase), structuredClone(v03Entry(
    relationalCase,
    'strengthens',
    0.8,
    dist(0.8, 0.05, 0.1, 0.05),
  )));
}
const replay = await runRelationalJudgmentBatch({
  batch,
  relationalCases: [...relationalCases].reverse(),
  maxLiveQuestions: 0,
  cache: fullCache,
  fetchImpl: async () => {
    throw new Error('cache-only replay must not reach provider');
  },
});
assert.equal(replay.run.providerRequestCount, 0);
assert.equal(replay.run.counts.cached, 6);
assert.equal(replay.run.counts.live, 0);
validateRelationalJudgmentRun(replay.run, {
  batch,
  requestPlan: replay.requestPlan,
  relationalCases,
  judgments: replay.judgments,
  cacheEntries: replay.cacheEntries,
});

// Retired parameter fails fast.
await assert.rejects(() => runRelationalJudgmentBatch({
  batch,
  relationalCases,
  maxLiveCalls: 1,
}), /maxLiveCalls/);

// JS16/JS18/JS19/JS20/JS21/JS22 boundaries.
const source = await readFile(
  new URL('../src/relations/relational-judgment-batch.mjs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(source, /riskScore|overallRisk|winnerScore|autoPromote/);
assert.doesNotMatch(source, /freezeRelationalOutcome|relationalCalibrationRecord/);
assert.doesNotMatch(source, /h19s|shadow-01/i);
assert.doesNotMatch(source, /process\.env|JEV_API_KEY|TYPESAFE_API_KEY/);
assert.equal(JSON.stringify(batch), batchBefore);
assert.equal(JSON.stringify(relationalCases), casesBefore);

// Persistence failure must preserve accepted results and persist later siblings.
{
  const goodResponse = async () => okJson({ model: JEV_RELATIONAL_MODEL,
    answers: { relation: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)) } });
  const reference = await runRelationalJudgmentBatch({ batch, relationalCases,
    maxLiveQuestions: 4, apiKey: 'fixture-key', fetchImpl: goodResponse });
  const failingCache = new MemoryCache();
  let attempts = 0;
  const persist = failingCache.set.bind(failingCache);
  failingCache.set = async (...args) => {
    attempts += 1;
    if (attempts === 2) throw new Error('disk failure with private fixture-key details');
    return persist(...args);
  };
  const result = await runRelationalJudgmentBatch({ batch, relationalCases,
    maxLiveQuestions: 4, apiKey: 'fixture-key', cache: failingCache, fetchImpl: goodResponse });
  assert.equal(attempts, 4);
  assert.equal(failingCache.writes, 3);
  assert.deepEqual(result.run, reference.run, 'persistence cannot change scientific identity');
  assert.deepEqual(result.judgments, reference.judgments);
  assert.deepEqual(result.cacheEntries, reference.cacheEntries);
  assert.deepEqual(result.cacheWriteErrors, [{ caseSha256: byOrder[1].caseSha256,
    cacheKey: keyOf(byOrder[1]), errorCode: 'cache_write_failed' }]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-key|private|disk failure/);
  validateRelationalJudgmentRun(result.run, { batch, relationalCases,
    requestPlan: result.requestPlan, judgments: result.judgments, cacheEntries: result.cacheEntries });
}

// A well-formed receipt still has to describe the exact request for its case.
{
  const entry = freezeJevRelationalCacheEntry({
    judgment: judgmentFor(byOrder[0], 'strengthens', 0.8),
    probabilities: dist(0.8, 0.05, 0.1, 0.05),
    requestSha256: jevRelationalRequestSha256(buildJevRelationalSingleCaseRequest({
      relationalCase: byOrder[1], model: JEV_RELATIONAL_MODEL,
    })),
  });
  assert.throws(() => validateJevRelationalCacheEntry(entry, {
    relationalCase: byOrder[0], provider: 'typesafe', model: JEV_RELATIONAL_MODEL,
  }), /exact single-case request/);
  const receiptCache = new MemoryCache();
  receiptCache.map.set(keyOf(byOrder[0]), entry);
  const result = await runRelationalJudgmentBatch({ batch, relationalCases,
    maxLiveQuestions: 0, cache: receiptCache,
    fetchImpl: async () => { throw new Error('invalid receipt must not call provider'); } });
  assert.equal(result.run.rows[0].errorCode, 'invalid_cache');
  assert.equal(result.run.providerRequestCount, 0);
}

// Exercise AbortSignal.timeout itself and retain a successful sibling.
{
  let calls = 0;
  const result = await runRelationalJudgmentBatch({ batch, relationalCases,
    maxLiveQuestions: 2, apiKey: 'k', timeoutMs: 15,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return okJson({ model: JEV_RELATIONAL_MODEL,
        answers: { relation: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)) } });
      return new Promise((resolve, reject) => {
        const watchdog = setTimeout(() => reject(new Error('abort not delivered')), 1000);
        const abort = () => { clearTimeout(watchdog); reject(options.signal.reason); };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  assert.equal(calls, 2, 'no timeout retry');
  assert.equal(result.run.rows[0].kind, 'answered');
  assert.equal(result.run.rows[1].errorCode, 'timeout');
}

// Actual 20-case transport bound; input budgets outside 0..20 fail before work.
{
  const manyHypotheses = Array.from({ length: 21 }, (_, index) => hypothesis(index + 10));
  const manyPacket = freezeCoverageDiscoveryPacket({ changeId: 'bound-20', sourceRevision: 'rev-1',
    impact: { changedFiles: manyHypotheses.map((item) => item.target.path), unknowns: [], safeToNarrow: true },
    discovery: { hypotheses: manyHypotheses } });
  const many = composeRelationalCaseBatch({ packet: manyPacket,
    factPool: manyHypotheses.flatMap((item, index) => [
      fact({ factId: `bound-m:${index}`, family: 'mutation', path: item.target.path }),
      fact({ factId: `bound-c:${index}`, family: 'coverage', path: item.target.path }),
    ]) });
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const boundedFetch = async () => {
    calls += 1; inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    return okJson({ model: JEV_RELATIONAL_MODEL,
      answers: { relation: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)) } });
  };
  const result = await runRelationalJudgmentBatch({ ...many, apiKey: 'k', fetchImpl: boundedFetch });
  assert.equal(many.batch.cases.length, 20);
  assert.equal(many.batch.skipped.filter((row) => row.reason === 'batch-cap').length, 1);
  assert.equal(calls, 20);
  assert.equal(peak, 20);
  assert.equal(result.run.providerRequestCount, 20);
  for (const budget of [-1, 21, 0.5]) {
    await assert.rejects(() => runRelationalJudgmentBatch({ ...many,
      maxLiveQuestions: budget, apiKey: 'k', fetchImpl: boundedFetch }));
  }
  assert.equal(calls, 20);
}

// Wrong model and extra answer IDs fail locally without discarding a valid sibling.
{
  let calls = 0;
  const result = await runRelationalJudgmentBatch({ batch, relationalCases,
    maxLiveQuestions: 3, apiKey: 'k', fetchImpl: async () => {
      calls += 1;
      const payload = { model: JEV_RELATIONAL_MODEL,
        answers: { relation: answer('strengthens', 0.8, dist(0.8, 0.05, 0.1, 0.05)) } };
      if (calls === 1) payload.model = 'other-model';
      if (calls === 2) payload.answers.extra = payload.answers.relation;
      return okJson(payload);
    } });
  assert.equal(result.run.rows[0].errorCode, 'model_mismatch');
  assert.equal(result.run.rows[1].errorCode, 'answer_set_mismatch');
  assert.equal(result.run.rows[2].kind, 'answered');
  assert.equal(result.cacheEntries.length, 1);
}

console.log('H19 Kit M10 concurrent single-case judgment smoke passed (JS1-JS22 + repair regressions).');
