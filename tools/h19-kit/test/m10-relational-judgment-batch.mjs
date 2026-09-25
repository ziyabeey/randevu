import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';
import { stableJson } from '../src/core/cache.mjs';
import { composeRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';
import {
  freezeJevRelationalJudgment,
} from '../src/relations/relational-evidence.mjs';
import {
  JEV_RELATIONAL_CACHE_NAMESPACE,
  JEV_RELATIONAL_MODEL,
  askJevRelationalDirection,
  freezeJevRelationalCacheEntry,
  jevRelationalCacheKey,
} from '../src/adapters/jev-relational.mjs';
import {
  RELATIONAL_JUDGMENT_GATE,
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

const hypotheses = [0, 1, 2, 3, 4].map(hypothesis);
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
assert.equal(composed.batch.cases.length, 5);
const { batch, relationalCases } = composed;
const byOrder = batch.cases.map((summary) => relationalCases.find((item) => item.caseSha256 === summary.caseSha256));

// JF1/JF2 — exact batch binding and deterministic plan replay.
const planA = buildRelationalJudgmentRequestPlan({ batch, relationalCases });
const planB = buildRelationalJudgmentRequestPlan({ batch, relationalCases: [...relationalCases].reverse() });
assert.equal(planA.requestPlanSha256, planB.requestPlanSha256);
assert.deepEqual(planA.rows.map((row) => row.caseSha256), batch.cases.map((row) => row.caseSha256));
assert.equal(validateRelationalJudgmentRequestPlan(planA, { batch, relationalCases }), planA);
const tamperedPlan = structuredClone(planA);
tamperedPlan.rows[0].caseSha256 = '0'.repeat(64);
assert.throws(() => validateRelationalJudgmentRequestPlan(tamperedPlan), /hash mismatch/);
let bindingFetches = 0;
await assert.rejects(() => runRelationalJudgmentBatch({
  batch,
  relationalCases: relationalCases.slice(0, 4),
  apiKey: 'k',
  fetchImpl: async () => { bindingFetches += 1; throw new Error('must not reach provider'); },
}), /artifact count|exactly match|missing relational case/);
assert.equal(bindingFetches, 0);

class MemoryCache {
  constructor() { this.map = new Map(); this.writes = 0; }
  async get(_namespace, key) { return this.map.get(key) ?? null; }
  async set(namespace, key, value) {
    assert.equal(namespace, JEV_RELATIONAL_CACHE_NAMESPACE);
    this.writes += 1;
    this.map.set(key, structuredClone(value));
  }
  snapshot() { return JSON.stringify([...this.map.entries()]); }
}
const keyOf = (relationalCase) => jevRelationalCacheKey({ relationalCase, provider: 'typesafe', model: JEV_RELATIONAL_MODEL });
const judgmentFor = (relationalCase, choice, confidence, model = JEV_RELATIONAL_MODEL) => freezeJevRelationalJudgment({
  relationalCase, provider: 'typesafe', model, answer: { choice, confidence },
});
const dist = (strengthens, weakens, unrelated, insufficient) => ({ strengthens, weakens, unrelated, insufficient });

// Seeded cache: case 0 is a probability-complete v0.2 entry, case 1 a valid legacy judgment-only entry.
function seededCache() {
  const cache = new MemoryCache();
  cache.map.set(keyOf(byOrder[0]), structuredClone(freezeJevRelationalCacheEntry({
    judgment: judgmentFor(byOrder[0], 'strengthens', 0.82),
    probabilities: dist(0.84, 0.06, 0.07, 0.03),
  })));
  cache.map.set(keyOf(byOrder[1]), structuredClone(judgmentFor(byOrder[1], 'weakens', 0.7)));
  return cache;
}

const secret = 'super-secret-jev-key';
const answer = (choice, confidence, probabilities) => ({ type: 'choice', choice, confidence, probabilities });
function fakeProvider(respond) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return respond(JSON.parse(options.body));
  };
  return { calls, fetchImpl };
}
const okJson = (json) => ({ ok: true, status: 200, async json() { return json; } });
const goodAnswers = (body) => {
  const ids = Object.keys(body.questions);
  const pool = [
    answer('insufficient', 0.61, dist(0.1, 0.1, 0.18, 0.62)),
    answer('strengthens', 0.77, dist(0.79, 0.05, 0.1, 0.06)),
    answer('unrelated', 0.55, dist(0.2, 0.1, 0.57, 0.13)),
  ];
  return okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(ids.map((id, i) => [id, pool[i % pool.length]])) });
};

// JF3/JF4/JF5/JF6/JF7/JF8/JF11/JF12/JF13/JF15/JF20 — cache first, upgrade-required, one fan-out request,
// path-bound questions, deterministic overflow, probabilities + confidence preserved.
const batchBefore = JSON.stringify(batch);
const casesBefore = JSON.stringify(relationalCases);
const cache = seededCache();
const live = fakeProvider(goodAnswers);
const firstRun = await runRelationalJudgmentBatch({
  batch, relationalCases, maxLiveQuestions: 2, apiKey: secret, cache, fetchImpl: live.fetchImpl,
});
assert.equal(live.calls.length, 1);
assert.equal(live.calls[0].options.headers.authorization, `Bearer ${secret}`);
const sent = live.calls[0].body;
assert.equal(sent.model, JEV_RELATIONAL_MODEL);
assert.equal(sent.state.schemaVersion, 1);
assert.deepEqual(sent.state.cases.map((item) => item.caseSha256), [byOrder[1].caseSha256, byOrder[2].caseSha256]);
assert.deepEqual(Object.keys(sent.questions), ['q00', 'q01']);
assert.match(sent.questions.q00.instructions, /^Evaluate only cases\[0\]\.state /);
assert.match(sent.questions.q01.instructions, /^Evaluate only cases\[1\]\.state /);
assert.doesNotMatch(sent.questions.q00.instructions, /cases\[1\]/);
assert.doesNotMatch(sent.questions.q01.instructions, /cases\[0\]/);
assert.deepEqual(Object.keys(sent.questions.q00.criteria), ['strengthens', 'weakens', 'unrelated', 'insufficient']);
assert.doesNotMatch(live.calls[0].options.body, new RegExp(secret));

const rows = firstRun.run.rows;
assert.equal(firstRun.run.gate, RELATIONAL_JUDGMENT_GATE);
assert.equal(firstRun.run.providerRequestCount, 1);
assert.match(firstRun.run.fanoutRequestSha256, /^[a-f0-9]{64}$/);
assert.equal(rows[0].source, 'cache');
assert.equal(rows[0].cacheStatus, 'hit');
assert.deepEqual(rows[0].probabilities, dist(0.84, 0.06, 0.07, 0.03));
assert.equal(rows[1].source, 'live');
assert.equal(rows[1].cacheStatus, 'upgrade-required');
assert.equal(rows[1].choice, 'insufficient');
assert.equal(rows[1].kind, 'answered');
assert.equal(rows[1].providerConfidence, 0.61);
assert.deepEqual(rows[1].probabilities, dist(0.1, 0.1, 0.18, 0.62));
assert.equal(rows[2].source, 'live');
assert.equal(rows[2].cacheStatus, 'miss');
assert.equal(rows[2].choice, 'strengthens');
for (const index of [3, 4]) {
  assert.equal(rows[index].kind, 'skipped');
  assert.equal(rows[index].reason, 'live-question-budget');
}
assert.deepEqual(firstRun.run.counts, { cached: 1, live: 2, answered: 3, insufficient: 1, error: 0, skipped: 2 });
assert.equal(cache.writes, 2);
assert.equal(JSON.stringify(batch), batchBefore);
assert.equal(JSON.stringify(relationalCases), casesBefore);
assert.doesNotMatch(JSON.stringify(firstRun), new RegExp(secret));
assert.doesNotMatch(cache.snapshot(), new RegExp(secret));
assert.equal(validateRelationalJudgmentRun(firstRun.run, {
  batch, requestPlan: firstRun.requestPlan, relationalCases, judgments: firstRun.judgments, cacheEntries: firstRun.cacheEntries,
}), firstRun.run);

// JF14/JF15 — partial replay: the next run replays the three answered cases and fans out only the rest.
const second = fakeProvider(goodAnswers);
const secondRun = await runRelationalJudgmentBatch({
  batch, relationalCases, maxLiveQuestions: 20, apiKey: secret, cache, fetchImpl: second.fetchImpl,
});
assert.equal(second.calls.length, 1);
assert.deepEqual(second.calls[0].body.state.cases.map((item) => item.caseSha256), [byOrder[3].caseSha256, byOrder[4].caseSha256]);
assert.deepEqual(secondRun.run.rows.map((row) => row.source), ['cache', 'cache', 'cache', 'live', 'live']);
assert.deepEqual(secondRun.run.rows[1].probabilities, dist(0.1, 0.1, 0.18, 0.62));

// JF7/JF17 — a fully cached run makes zero provider requests and its identity is order- and time-independent.
const noProvider = async () => { throw new Error('provider must not run during cache-only replay'); };
const replayA = await runRelationalJudgmentBatch({ batch, relationalCases, maxLiveQuestions: 0, cache, fetchImpl: noProvider });
const replayB = await runRelationalJudgmentBatch({
  batch, relationalCases: [...relationalCases].reverse(), maxLiveQuestions: 0, cache, fetchImpl: noProvider,
});
assert.equal(replayA.run.providerRequestCount, 0);
assert.equal(replayA.run.fanoutRequestSha256, null);
assert.equal(replayA.run.counts.cached, 5);
assert.equal(replayA.run.judgmentRunSha256, replayB.run.judgmentRunSha256);
validateRelationalJudgmentRun(replayA.run, { batch, requestPlan: replayA.requestPlan, relationalCases, judgments: replayA.judgments, cacheEntries: replayA.cacheEntries });
const liveTwinA = await runRelationalJudgmentBatch({ batch, relationalCases, maxLiveQuestions: 5, apiKey: secret, cache: new MemoryCache(), fetchImpl: fakeProvider(goodAnswers).fetchImpl });
const liveTwinB = await runRelationalJudgmentBatch({ batch, relationalCases, maxLiveQuestions: 5, apiKey: secret, cache: new MemoryCache(), fetchImpl: fakeProvider(goodAnswers).fetchImpl });
assert.equal(liveTwinA.run.judgmentRunSha256, liveTwinB.run.judgmentRunSha256);

// The single-case M8 adapter still replays a v0.2 entry as its exact judgment.
const adapterReplay = await askJevRelationalDirection({ relationalCase: byOrder[2], apiKey: '', cache, fetchImpl: noProvider });
assert.equal(adapterReplay.cached, true);
assert.equal(adapterReplay.judgment.choice, 'strengthens');

// JF4 — tampered or identity-invalid exact-key content is invalid_cache and never falls back to live.
const tamperedCache = seededCache();
const tamperedEntry = structuredClone(tamperedCache.map.get(keyOf(byOrder[0])));
tamperedEntry.probabilities.strengthens = 0.5;
tamperedCache.map.set(keyOf(byOrder[0]), tamperedEntry);
tamperedCache.map.set(keyOf(byOrder[1]), structuredClone(judgmentFor(byOrder[1], 'unrelated', 0.5, 'jev-wrong-model')));
const invalidProbe = fakeProvider(goodAnswers);
const invalidRun = await runRelationalJudgmentBatch({
  batch, relationalCases, maxLiveQuestions: 20, apiKey: secret, cache: tamperedCache, fetchImpl: invalidProbe.fetchImpl,
});
for (const index of [0, 1]) {
  assert.equal(invalidRun.run.rows[index].kind, 'error');
  assert.equal(invalidRun.run.rows[index].source, 'cache');
  assert.equal(invalidRun.run.rows[index].cacheStatus, 'invalid');
  assert.equal(invalidRun.run.rows[index].errorCode, 'invalid_cache');
}
assert.deepEqual(invalidProbe.calls[0].body.state.cases.map((item) => item.caseSha256), byOrder.slice(2).map((item) => item.caseSha256));

// JF9/JF10/JF14 — atomic live acceptance: any defect fails every selected live row and caches none of them;
// cache hits and budget skips are untouched.
const failures = [
  ['missing answer', () => { return okJson({ model: JEV_RELATIONAL_MODEL, answers: { q00: answer('weakens', 0.6, dist(0.1, 0.6, 0.2, 0.1)) } }); }, 'answer_set_mismatch'],
  ['extra answer', (body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: { ...Object.fromEntries(Object.keys(body.questions).map((id) => [id, answer('weakens', 0.6, dist(0.1, 0.6, 0.2, 0.1))])), q99: answer('weakens', 0.6, dist(0.1, 0.6, 0.2, 0.1)) } }), 'answer_set_mismatch'],
  ['wrong model', (body) => okJson({ model: 'jev-other', answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, answer('weakens', 0.6, dist(0.1, 0.6, 0.2, 0.1))])) }), 'model_mismatch'],
  ['choice outside domain', (body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((id, i) => [id, i === 1 ? answer('maybe', 0.6, dist(0.1, 0.6, 0.2, 0.1)) : answer('weakens', 0.6, dist(0.1, 0.6, 0.2, 0.1))])) }), 'invalid_answer'],
  ['probability keys', (body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, answer('weakens', 0.6, { strengthens: 0.4, weakens: 0.6 })])) }), 'invalid_answer'],
  ['probability sum', (body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, answer('weakens', 0.6, dist(0.3, 0.6, 0.2, 0.1))])) }), 'invalid_answer'],
  ['untyped answer', (body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { choice: 'weakens', confidence: 0.6, probabilities: dist(0.1, 0.6, 0.2, 0.1) }])) }), 'invalid_answer'],
  ['http 503', () => ({ ok: false, status: 503 }), 'http_503'],
  ['transport', () => { throw new Error('socket hang up'); }, 'transport_error'],
  ['timeout', () => { const error = new Error('The operation was aborted due to timeout'); error.name = 'TimeoutError'; throw error; }, 'timeout'],
];
for (const [name, respond, code] of failures) {
  const failCache = seededCache();
  const before = failCache.snapshot();
  const provider = fakeProvider(respond);
  const result = await runRelationalJudgmentBatch({
    batch, relationalCases, maxLiveQuestions: 3, apiKey: secret, cache: failCache, fetchImpl: provider.fetchImpl,
  });
  assert.equal(provider.calls.length, 1, name);
  assert.equal(result.run.providerRequestCount, 1, name);
  assert.equal(failCache.writes, 0, `${name}: nothing from a rejected response is cached`);
  assert.equal(failCache.snapshot(), before, name);
  assert.equal(result.run.rows[0].cacheStatus, 'hit', name);
  assert.equal(result.run.rows[0].kind, 'answered', name);
  for (const index of [1, 2, 3]) {
    assert.equal(result.run.rows[index].kind, 'error', name);
    assert.equal(result.run.rows[index].source, 'live', name);
    assert.equal(result.run.rows[index].errorCode, code, name);
  }
  assert.equal(result.run.rows[4].reason, 'live-question-budget', name);
  validateRelationalJudgmentRun(result.run, { batch, requestPlan: result.requestPlan, relationalCases, judgments: result.judgments, cacheEntries: result.cacheEntries });
}

// Missing credentials: bounded errors, zero provider requests, nothing persisted.
let missingKeyFetches = 0;
const missingKeyRun = await runRelationalJudgmentBatch({
  batch, relationalCases, maxLiveQuestions: 2, apiKey: '', cache: new MemoryCache(),
  fetchImpl: async () => { missingKeyFetches += 1; throw new Error('missing key must not reach provider'); },
});
assert.equal(missingKeyFetches, 0);
assert.equal(missingKeyRun.run.providerRequestCount, 0);
assert.equal(missingKeyRun.run.rows[0].errorCode, 'missing_api_key');
validateRelationalJudgmentRun(missingKeyRun.run);

// JF5 — invalid budgets and the retired v0.1 parameter fail before provider work.
await assert.rejects(() => runRelationalJudgmentBatch({ batch, relationalCases, maxLiveQuestions: 21, apiKey: secret }), /between 0 and 20/);
await assert.rejects(() => runRelationalJudgmentBatch({ batch, relationalCases, maxLiveCalls: 1, apiKey: secret }), /replaced by maxLiveQuestions/);

// Run validator rejects forged zero-or-one, ordering and partial-acceptance claims.
const { judgmentRunSha256: _drop, ...runBody } = structuredClone(firstRun.run);
const reseal = (mutate) => {
  const body = structuredClone(runBody);
  mutate(body);
  return { ...body, judgmentRunSha256: createHash('sha256').update(`${stableJson(body)}\n`).digest('hex') };
};
assert.throws(() => validateRelationalJudgmentRun({ ...firstRun.run, providerRequestCount: 2 }), /hash mismatch/);
assert.throws(() => validateRelationalJudgmentRun(reseal((b) => { b.providerRequestCount = 2; })), /exactly one provider request/);
assert.throws(() => validateRelationalJudgmentRun(reseal((b) => { b.maxLiveQuestions = 3; })), /budget skip while/);
assert.throws(() => validateRelationalJudgmentRun(reseal((b) => { b.rows[1].probabilities = dist(0.5, 0.5, 0.5, 0.5); })), /invalid answered/);
assert.throws(() => validateRelationalJudgmentRun(reseal((b) => {
  b.rows[2] = { ...b.rows[2], kind: 'error', choice: null, probabilities: null, providerConfidence: null, errorCode: 'http_500' };
  b.counts = { ...b.counts, answered: 2, error: 1 };
})), /partial live acceptance/);

// JF12 — provider confidence is metadata only: different confidences leave selection, budget and request identical.
const confidenceRun = (confidence) => runRelationalJudgmentBatch({
  batch, relationalCases, maxLiveQuestions: 3, apiKey: secret, cache: seededCache(),
  fetchImpl: fakeProvider((body) => okJson({ model: JEV_RELATIONAL_MODEL, answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, answer('weakens', confidence, dist(0.1, 0.6, 0.2, 0.1))])) })).fetchImpl,
});
const lowConfidence = await confidenceRun(0.05);
const highConfidence = await confidenceRun(0.99);
assert.equal(lowConfidence.run.fanoutRequestSha256, highConfidence.run.fanoutRequestSha256);
assert.deepEqual(
  lowConfidence.run.rows.map((row) => [row.caseSha256, row.kind, row.source, row.reason]),
  highConfidence.run.rows.map((row) => [row.caseSha256, row.kind, row.source, row.reason]),
);

// JF12/JF16/JF18/JF19/JF20/JF21/JF22 — no authority escalation, aggregate score, self-calibration,
// credential access, live-CI dependency or H19s crossover.
const source = await readFile(new URL('../src/relations/relational-judgment-batch.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(source, /riskScore|overallRisk|winnerScore|autoPromote/);
assert.doesNotMatch(source, /freezeRelationalOutcome|relationalCalibrationRecord/);
assert.doesNotMatch(source, /h19s|shadow-01|experiments\/jev-tr-eval/i);
assert.doesNotMatch(source, /process\.env|JEV_API_KEY|TYPESAFE_API_KEY/);
assert.equal(firstRun.run.authority, 'advisory');
assert.equal(JSON.stringify(batch), batchBefore);
assert.equal(JSON.stringify(relationalCases), casesBefore);

console.log('H19 Kit M10 relational judgment fan-out smoke passed (JF1-JF22).');
