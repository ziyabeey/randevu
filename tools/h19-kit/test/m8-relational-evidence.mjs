import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildRelationalEvidenceCase,
  freezeDeterministicFeature,
  freezeJevRelationalJudgment,
  freezeRelationalOutcome,
  relationalCalibrationRecord,
  relationalInputDigest,
  sameMetricRatioFeature,
  validateJevRelationalJudgment,
  validateRelationalEvidenceCase,
  validateRelationalOutcome,
} from '../src/relations/relational-evidence.mjs';
import {
  JEV_RELATIONAL_MODEL,
  askJevRelationalDirection,
} from '../src/adapters/jev-relational.mjs';
import { freezeCoverageDiscoveryPacket } from '../src/discovery/validation-packet.mjs';

const hypothesis = {
  id: 'coverage:surviving-mutant:mut-17:worker_bookings.ts',
  target: {
    kind: 'semantic-unit',
    path: 'worker/bookings.ts',
    unitId: 'worker/bookings.ts::createBooking@40',
  },
  reason: 'surviving-mutant',
  priority: 'high',
  evidenceIds: ['mutation.survivor.present'],
  validation: {
    preferred: 'test-that-kills-mutant',
    mutatorId: 'boundary.flip',
    mutationId: 'mut-17',
    requiresRuntimeEvidence: true,
  },
};

function packet(sourceRevision = 'abc123') {
  return freezeCoverageDiscoveryPacket({
    changeId: 'pr-123',
    sourceRevision,
    impact: {
      changedFiles: ['worker/bookings.ts'],
      unknowns: [],
      safeToNarrow: true,
    },
    discovery: { hypotheses: [hypothesis] },
  });
}

function provenance(producer, sourceRevision = 'abc123', evidenceIds = []) {
  return {
    producer,
    producerVersion: '1',
    inputDigest: `input:${producer}`,
    sourceRevision,
    evidenceIds,
  };
}

const mutation = {
  factId: 'fact:mutation-escape',
  family: 'mutation',
  state: 'present',
  metricId: 'mutation.escape.rate',
  value: 0.20,
  unit: 'ratio',
  denominator: 20,
  sampleSize: 20,
  baseline: {
    value: 0.05,
    sampleSize: 200,
    sourceId: 'baseline:mutation-escape',
  },
  lineageIds: ['mutation-run:17'],
  provenance: provenance('mutation-runner', 'abc123', ['mutation.survivor.present']),
};

const coverage = {
  factId: 'fact:test-density',
  family: 'coverage',
  state: 'present',
  metricId: 'coverage.test-density',
  value: 0.45,
  unit: 'ratio',
  denominator: 11,
  sampleSize: 11,
  baseline: {
    value: 0.75,
    sampleSize: 300,
    sourceId: 'baseline:test-density',
  },
  lineageIds: ['coverage-run:9'],
  provenance: provenance('coverage-impact', 'abc123', ['impact.coverage_gap.present']),
};

const history = {
  factId: 'fact:temporal-coupling',
  family: 'history',
  state: 'present',
  metricId: 'history.temporal-coupling',
  value: 0.82,
  unit: 'ratio',
  denominator: null,
  sampleSize: 41,
  baseline: {
    value: 0.60,
    sampleSize: 400,
    sourceId: 'baseline:temporal-coupling',
  },
  lineageIds: ['history-window:41'],
  provenance: provenance('git-hotspots', 'abc123', ['history.companion.missing']),
};

const coverageDerived = {
  ...coverage,
  factId: 'fact:coverage-derived',
  metricId: 'coverage.impacted-gap-rate',
  value: 0.55,
  baseline: {
    value: 0.30,
    sampleSize: 300,
    sourceId: 'baseline:impacted-gap-rate',
  },
  // Same lineage as coverage: must not count as a new independent signal.
  lineageIds: ['coverage-run:9'],
};

const extra = [
  freezeDeterministicFeature({
    featureId: 'agreement-count:case',
    kind: 'agreement-count',
    state: 'known',
    value: 2,
    sampleSize: null,
    factIds: [mutation.factId, history.factId],
  }),
  freezeDeterministicFeature({
    featureId: 'contradiction-count:case',
    kind: 'contradiction-count',
    state: 'known',
    value: 1,
    sampleSize: null,
    factIds: [coverage.factId],
  }),
];

const frozenPacket = packet();

// RE1/RE2/RE5/RE9: provenance-bound deterministic case, canonical ordering,
// lineage-aware independent count, contradictions preserved instead of averaged.
const a = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [mutation, coverage, history, coverageDerived],
  extraFeatures: extra,
});
const b = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [coverageDerived, history, coverage, mutation],
  extraFeatures: [...extra].reverse(),
});
assert.equal(a.caseSha256, b.caseSha256);
assert.equal(validateRelationalEvidenceCase(a, { packet: frozenPacket }), a);
assert.equal(a.authority, 'advisory');
assert.equal(Object.isFrozen(a), true);
assert.equal('score' in a, false);

const independent = a.deterministicFeatures.find((feature) => feature.kind === 'independent-family-count');
const overlap = a.deterministicFeatures.find((feature) => feature.kind === 'lineage-overlap');
assert.equal(independent.value, 3);
assert.equal(overlap.value, true);
assert.equal(a.deterministicFeatures.find((feature) => feature.kind === 'agreement-count').value, 2);
assert.equal(a.deterministicFeatures.find((feature) => feature.kind === 'contradiction-count').value, 1);

const mutationLift = a.deterministicFeatures.find((feature) => feature.featureId === 'lift:fact:mutation-escape');
assert.equal(mutationLift.value, 4);

const changedValue = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [{ ...mutation, value: 0.21 }, coverage, history, coverageDerived],
  extraFeatures: extra,
});
assert.notEqual(a.caseSha256, changedValue.caseSha256);

const changedLineage = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [{ ...mutation, lineageIds: ['mutation-run:18'] }, coverage, history, coverageDerived],
  extraFeatures: extra,
});
assert.notEqual(a.caseSha256, changedLineage.caseSha256);

const changedProducer = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [{
    ...mutation,
    provenance: { ...mutation.provenance, producerVersion: '2' },
  }, coverage, history, coverageDerived],
  extraFeatures: extra,
});
assert.notEqual(a.caseSha256, changedProducer.caseSha256);

const revision2 = packet('def456');
const changedRevision = buildRelationalEvidenceCase({
  packet: revision2,
  hypothesisId: hypothesis.id,
  facts: [mutation, coverage, history, coverageDerived],
  extraFeatures: extra,
});
assert.notEqual(a.caseSha256, changedRevision.caseSha256);

// RE3: unknown stays unknown; missing baseline is not zero.
const unknownCoverage = {
  factId: 'fact:unknown-coverage',
  family: 'coverage',
  state: 'unknown',
  metricId: 'coverage.runtime',
  value: null,
  unit: 'ratio',
  denominator: null,
  sampleSize: null,
  baseline: null,
  lineageIds: ['coverage:unknown'],
  provenance: provenance('coverage-impact', 'abc123', ['impact.references.present']),
};
const unknownCase = buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [mutation, unknownCoverage],
});
for (const featureId of ['baseline-delta:fact:unknown-coverage', 'lift:fact:unknown-coverage']) {
  const feature = unknownCase.deterministicFeatures.find((item) => item.featureId === featureId);
  assert.equal(feature.state, 'unknown');
  assert.equal(feature.value, null);
}
assert.throws(() => buildRelationalEvidenceCase({
  packet: frozenPacket,
  hypothesisId: hypothesis.id,
  facts: [mutation, { ...unknownCoverage, value: 0 }],
}), /unknown fact must carry null value/);

// RE4: ratios are dimension-safe in the generic core.
const historicalMutation = {
  ...mutation,
  factId: 'fact:mutation-escape-prior',
  value: 0.10,
  baseline: null,
  lineageIds: ['mutation-run:prior'],
  provenance: provenance('mutation-history', 'prior'),
};
const ratio = sameMetricRatioFeature(mutation, historicalMutation);
assert.equal(ratio.state, 'known');
assert.equal(ratio.value, 2);
assert.throws(() => sameMetricRatioFeature(mutation, coverage), /identical metricId/);

const zeroDenominatorMetric = {
  ...historicalMutation,
  factId: 'fact:mutation-zero',
  value: 0,
};
const unknownRatio = sameMetricRatioFeature(mutation, zeroDenominatorMetric);
assert.equal(unknownRatio.state, 'unknown');
assert.equal(unknownRatio.value, null);

// RE6/RE7/RE12: bounded Jev output with immutable case identity.
const caseShaBefore = a.caseSha256;
const inputDigest = relationalInputDigest(a);
const judgment = freezeJevRelationalJudgment({
  relationalCase: a,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
  answer: { choice: 'strengthens', confidence: 0.87 },
  inputSha256: inputDigest,
});
assert.equal(validateJevRelationalJudgment(judgment, { relationalCase: a }), judgment);
assert.equal(a.caseSha256, caseShaBefore);
assert.throws(() => freezeJevRelationalJudgment({
  relationalCase: a,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
  answer: { choice: 'high-risk', confidence: 0.99 },
}), /invalid relation choice/);
assert.throws(() => freezeJevRelationalJudgment({
  relationalCase: a,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
  answer: { choice: 'strengthens', confidence: 0.87 },
  inputSha256: '0'.repeat(64),
}), /input digest mismatch/);

// RE8: provider errors are frozen advisory artifacts and do not modify the case.
const errorJudgment = freezeJevRelationalJudgment({
  relationalCase: a,
  provider: 'typesafe',
  model: JEV_RELATIONAL_MODEL,
  errorCode: 'timeout',
});
assert.equal(errorJudgment.status, 'error');
assert.equal(errorJudgment.choice, null);
assert.equal(errorJudgment.providerConfidence, null);
assert.equal(a.caseSha256, caseShaBefore);

// RE10/RE12: outcome is an independent immutable artifact.
const outcome = freezeRelationalOutcome({
  relationalCase: a,
  judgment,
  observedRevision: 'abc124',
  kind: 'mutation-run',
  value: 'mutant-killed',
  sourceDigest: 'b'.repeat(64),
});
assert.equal(validateRelationalOutcome(outcome, { relationalCase: a, judgment }), outcome);
assert.equal(outcome.caseSha256, a.caseSha256);
assert.equal(outcome.judgmentSha256, judgment.judgmentSha256);
assert.equal(a.caseSha256, caseShaBefore);
assert.throws(() => freezeRelationalOutcome({
  relationalCase: a,
  judgment,
  kind: 'jev',
  value: 'confirmed',
  sourceDigest: 'c'.repeat(64),
}), /invalid outcome kind/);

const calibration = relationalCalibrationRecord({
  relationalCase: a,
  judgment,
  outcome,
});
assert.equal(calibration.model, JEV_RELATIONAL_MODEL);
assert.equal(calibration.choice, 'strengthens');
assert.equal(calibration.providerConfidence, 0.87);
assert.equal(calibration.sampleCount, 1);
assert.throws(() => relationalCalibrationRecord({
  relationalCase: a,
  judgment: errorJudgment,
  outcome: freezeRelationalOutcome({
    relationalCase: a,
    judgment: errorJudgment,
    kind: 'manual-review',
    value: 'inconclusive',
    sourceDigest: 'd'.repeat(64),
  }),
}), /not calibration-eligible/);

// Adapter: successful answer is cached by model/question/input identity.
class MemoryCache {
  constructor() {
    this.map = new Map();
  }

  async get(namespace, key) {
    return this.map.get(`${namespace}:${key}`) ?? null;
  }

  async set(namespace, key, value) {
    this.map.set(`${namespace}:${key}`, structuredClone(value));
  }
}

const memory = new MemoryCache();
let providerCalls = 0;
const fakeFetch = async (url, options) => {
  providerCalls += 1;
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(options.method, 'POST');
  const body = JSON.parse(options.body);
  assert.equal(body.model, JEV_RELATIONAL_MODEL);
  assert.equal(body.questions.relation.type, 'choice');
  assert.equal(body.state.hypothesis.hypothesisId, hypothesis.id);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model: JEV_RELATIONAL_MODEL,
        answers: {
          relation: {
            choice: 'strengthens',
            confidence: 0.91,
          },
        },
      };
    },
  };
};

const liveA = await askJevRelationalDirection({
  relationalCase: a,
  apiKey: 'test-key',
  fetchImpl: fakeFetch,
  cache: memory,
});
assert.equal(liveA.cached, false);
assert.equal(liveA.judgment.status, 'answered');
assert.equal(liveA.judgment.choice, 'strengthens');
assert.equal(providerCalls, 1);

const liveB = await askJevRelationalDirection({
  relationalCase: a,
  apiKey: 'test-key',
  fetchImpl: fakeFetch,
  cache: memory,
});
assert.equal(liveB.cached, true);
assert.equal(liveB.judgment.judgmentSha256, liveA.judgment.judgmentSha256);
assert.equal(providerCalls, 1);

// Missing key and provider failures remain advisory/error-only.
const missingKey = await askJevRelationalDirection({
  relationalCase: a,
  apiKey: '',
  model: 'jev-test-no-key',
  fetchImpl: async () => {
    throw new Error('must not call provider without key');
  },
});
assert.equal(missingKey.judgment.status, 'error');
assert.equal(missingKey.judgment.errorCode, 'missing_api_key');

const providerFailure = await askJevRelationalDirection({
  relationalCase: a,
  apiKey: 'test-key',
  model: 'jev-test-failure',
  fetchImpl: async () => ({ ok: false, status: 503 }),
});
assert.equal(providerFailure.judgment.status, 'error');
assert.equal(providerFailure.judgment.errorCode, 'http_503');
assert.equal(a.caseSha256, caseShaBefore);

// RE13: the M8 implementation has no H19s dependency.
const coreSource = await readFile(new URL('../src/relations/relational-evidence.mjs', import.meta.url), 'utf8');
const adapterSource = await readFile(new URL('../src/adapters/jev-relational.mjs', import.meta.url), 'utf8');
assert.equal(/h19s/i.test(coreSource), false);
assert.equal(/h19s/i.test(adapterSource), false);

console.log('h19-kit M8 relational evidence smoke: ok');
