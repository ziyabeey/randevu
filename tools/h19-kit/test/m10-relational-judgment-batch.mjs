import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { composeRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';
import {
  freezeJevRelationalJudgment,
} from '../src/relations/relational-evidence.mjs';
import {
  JEV_RELATIONAL_MODEL,
  jevRelationalCacheKey,
} from '../src/adapters/jev-relational.mjs';
import {
  buildRelationalJudgmentRequestPlan,
  runRelationalJudgmentBatch,
  validateRelationalJudgmentRequestPlan,
  validateRelationalJudgmentRun,
} from '../src/relations/relational-judgment-batch.mjs';

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

const hypotheses = [0, 1, 2].map(hypothesis);
const packet = freezeCoverageDiscoveryPacket({
  changeId: 'change-m10',
  sourceRevision: 'rev-1',
  impact: {
    changedFiles: hypotheses.map((item) => item.target.path),
    unknowns: [],
    safeToNarrow: true,
  },
  discovery: { hypotheses },
});

const factPool = hypotheses.flatMap((item, index) => [
  fact({
    factId: `mutation:${index}`,
    family: 'mutation',
    path: item.target.path,
    value: index + 1,
  }),
  fact({
    factId: `coverage:${index}`,
    family: 'coverage',
    path: item.target.path,
    value: index + 2,
  }),
]);

const composed = composeRelationalCaseBatch({ packet, factPool });
assert.equal(composed.batch.cases.length, 3);

// JB1/JB2 — exact batch binding and deterministic plan replay.
const planA = buildRelationalJudgmentRequestPlan({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
});
const planB = buildRelationalJudgmentRequestPlan({
  batch: composed.batch,
  relationalCases: [...composed.relationalCases].reverse(),
});
assert.equal(planA.requestPlanSha256, planB.requestPlanSha256);
assert.deepEqual(
  planA.rows.map((row) => row.caseSha256),
  composed.batch.cases.map((row) => row.caseSha256),
);
assert.equal(
  validateRelationalJudgmentRequestPlan(planA, {
    batch: composed.batch,
    relationalCases: composed.relationalCases,
  }),
  planA,
);
assert.throws(() => buildRelationalJudgmentRequestPlan({
  batch: composed.batch,
  relationalCases: composed.relationalCases.slice(0, 2),
}), /artifact count|exactly match|missing relational case/);

const tamperedPlan = structuredClone(planA);
tamperedPlan.rows[0].caseSha256 = '0'.repeat(64);
assert.throws(
  () => validateRelationalJudgmentRequestPlan(tamperedPlan),
  /hash mismatch/,
);

class MemoryCache {
  constructor() {
    this.map = new Map();
  }

  async get(_namespace, key) {
    return this.map.get(key) ?? null;
  }

  async set(_namespace, key, value) {
    this.map.set(key, structuredClone(value));
  }
}

const [case0, case1, case2] = composed.relationalCases;
const cache = new MemoryCache();
const cachedJudgment = freezeJevRelationalJudgment({
  relationalCase: case0,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
  answer: { choice: 'strengthens', confidence: 0.82 },
});
await cache.set(
  'ignored',
  jevRelationalCacheKey({
    relationalCase: case0,
    provider: 'typesafe',
    model: JEV_RELATIONAL_MODEL,
  }),
  cachedJudgment,
);

// JB3/JB5/JB6/JB7/JB9/JB10 — cache first, one live slot, deterministic skip,
// valid insufficient answer and provider confidence preserved only as metadata.
let providerCalls = 0;
const secret = 'super-secret-jev-key';
const fakeFetch = async (_url, options) => {
  providerCalls += 1;
  assert.equal(options.headers.authorization, `Bearer ${secret}`);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model: JEV_RELATIONAL_MODEL,
        answers: {
          relation: {
            choice: 'insufficient',
            confidence: 0.61,
          },
        },
      };
    },
  };
};

const batchBefore = JSON.stringify(composed.batch);
const casesBefore = JSON.stringify(composed.relationalCases);
const firstRun = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
  maxLiveCalls: 1,
  apiKey: secret,
  cache,
  fetchImpl: fakeFetch,
});

assert.equal(providerCalls, 1);
assert.equal(firstRun.run.rows[0].source, 'cache');
assert.equal(firstRun.run.rows[0].choice, 'strengthens');
assert.equal(firstRun.run.rows[1].source, 'live');
assert.equal(firstRun.run.rows[1].choice, 'insufficient');
assert.equal(firstRun.run.rows[1].providerConfidence, 0.61);
assert.equal(firstRun.run.rows[2].kind, 'skipped');
assert.equal(firstRun.run.rows[2].reason, 'live-call-budget');
assert.deepEqual(firstRun.run.counts, {
  cached: 1,
  live: 1,
  answered: 2,
  insufficient: 1,
  error: 0,
  skipped: 1,
});
assert.equal(JSON.stringify(composed.batch), batchBefore);
assert.equal(JSON.stringify(composed.relationalCases), casesBefore);
assert.doesNotMatch(JSON.stringify(firstRun), new RegExp(secret));

assert.equal(validateRelationalJudgmentRun(firstRun.run, {
  batch: composed.batch,
  requestPlan: firstRun.requestPlan,
  relationalCases: composed.relationalCases,
  judgments: firstRun.judgments,
}), firstRun.run);

// JB3/JB12 — once answers are cached, replay is provider-free and deterministic.
const cachedReplayA = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
  maxLiveCalls: 0,
  apiKey: '',
  cache,
  fetchImpl: async () => {
    throw new Error('provider must not run during cache-only replay');
  },
});
const cachedReplayB = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: [...composed.relationalCases].reverse(),
  maxLiveCalls: 0,
  apiKey: '',
  cache,
  fetchImpl: async () => {
    throw new Error('provider must not run during cache-only replay');
  },
});
assert.equal(cachedReplayA.run.rows[0].source, 'cache');
assert.equal(cachedReplayA.run.rows[1].source, 'cache');
assert.equal(cachedReplayA.run.rows[2].kind, 'skipped');
assert.equal(cachedReplayA.run.judgmentRunSha256, cachedReplayB.run.judgmentRunSha256);

// JB4 — exact-key cache tampering/wrong identity fails closed for that row,
// never falling through into a live call.
const invalidCache = new MemoryCache();
const wrongModelJudgment = freezeJevRelationalJudgment({
  relationalCase: case0,
  provider: 'typesafe',
  model: 'jev-wrong-model',
  answer: { choice: 'unrelated', confidence: 0.5 },
});
await invalidCache.set(
  'ignored',
  jevRelationalCacheKey({
    relationalCase: case0,
    provider: 'typesafe',
    model: JEV_RELATIONAL_MODEL,
  }),
  wrongModelJudgment,
);
let invalidCacheFetches = 0;
const invalidCacheRun = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
  maxLiveCalls: 0,
  cache: invalidCache,
  fetchImpl: async () => {
    invalidCacheFetches += 1;
    throw new Error('must not call provider after invalid cache');
  },
});
assert.equal(invalidCacheFetches, 0);
assert.equal(invalidCacheRun.run.rows[0].kind, 'error');
assert.equal(invalidCacheRun.run.rows[0].source, 'cache');
assert.equal(invalidCacheRun.run.rows[0].errorCode, 'invalid_cache');

// JB7/JB8 — provider failure causes one attempt only and remains advisory.
let failureCalls = 0;
const failureRun = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
  maxLiveCalls: 1,
  apiKey: 'failure-key',
  cache: new MemoryCache(),
  fetchImpl: async () => {
    failureCalls += 1;
    return { ok: false, status: 503 };
  },
});
assert.equal(failureCalls, 1);
assert.equal(failureRun.run.rows[0].kind, 'error');
assert.equal(failureRun.run.rows[0].source, 'live');
assert.equal(failureRun.run.rows[0].errorCode, 'http_503');
assert.equal(failureRun.run.rows[1].reason, 'live-call-budget');
assert.equal(failureRun.run.rows[2].reason, 'live-call-budget');
assert.equal(failureRun.run.authority, 'advisory');

// JB8/JB15 — missing credentials are bounded error artifacts and never persisted.
let missingKeyFetches = 0;
const missingKeyRun = await runRelationalJudgmentBatch({
  batch: composed.batch,
  relationalCases: composed.relationalCases,
  maxLiveCalls: 1,
  apiKey: '',
  cache: new MemoryCache(),
  fetchImpl: async () => {
    missingKeyFetches += 1;
    throw new Error('missing key must not reach provider');
  },
});
assert.equal(missingKeyFetches, 0);
assert.equal(missingKeyRun.run.rows[0].errorCode, 'missing_api_key');

// JB5 — invalid budgets fail before provider work.
await assert.rejects(
  () => runRelationalJudgmentBatch({
    batch: composed.batch,
    relationalCases: composed.relationalCases,
    maxLiveCalls: 21,
    apiKey: secret,
    cache: new MemoryCache(),
    fetchImpl: fakeFetch,
  }),
  /between 0 and 20/,
);

// JB11/JB13/JB14/JB16/JB17 — no authority escalation, aggregate score,
// self-calibration, live-CI dependency or H19s crossover.
const source = await readFile(
  new URL('../src/relations/relational-judgment-batch.mjs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(source, /riskScore|overallRisk|winnerScore|autoPromote/);
assert.doesNotMatch(source, /freezeRelationalOutcome|relationalCalibrationRecord/);
assert.doesNotMatch(source, /h19s|shadow-01/i);
assert.doesNotMatch(source, /process\.env|JEV_API_KEY|TYPESAFE_API_KEY/);
assert.equal(firstRun.run.authority, 'advisory');
assert.equal(JSON.stringify(composed.batch), batchBefore);
assert.equal(JSON.stringify(composed.relationalCases), casesBefore);

console.log('H19 Kit M10 relational judgment batch smoke passed (JB1-JB17).');
