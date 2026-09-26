import assert from 'node:assert/strict';

import { routeJevQuestion } from '../src/routing/jev-utility-router.mjs';
import {
  buildJevUtilityLedger,
  freezeFakeJevExecutionObservation,
  validateFakeJevExecutionObservation,
} from '../src/routing/jev-utility-ledger.mjs';

function candidate({ fanout = false } = {}) {
  return {
    schemaVersion: 1,
    kind: 'h19-jev-question-candidate',
    question: {
      id: fanout ? 'BLIND_SPOT_TRIAGE' : 'RELATION_DIRECTION',
      version: '0.1',
      class: fanout ? 'blind-spot-triage' : 'relation-judgment',
      inputSha256: (fanout ? 'b' : 'a').repeat(64),
    },
    evidence: {
      completeness: 'partial',
      unknownCount: fanout ? 3 : 1,
      conflictCount: 0,
      lineageOverlap: false,
    },
    deterministic: {
      available: false,
      resolutionSha256: null,
    },
    cache: {
      status: 'miss',
      cacheKey: fanout ? 'fanout-key' : 'single-key',
      answerSha256: null,
    },
    live: {
      allowed: true,
      maxLiveQuestions: fanout ? 3 : 1,
      maxInputTokens: 200,
      maxOutputTokens: 50,
      monetaryCeiling: {
        amount: fanout ? 0.01 : 0.005,
        currency: 'USD',
        rateEvidence: 'fake-rate-v1',
      },
      timeoutMs: 30_000,
      evaluationMethodId: 'independent-eval-v1',
      fanout: fanout
        ? {
            requested: true,
            eligible: true,
            calls: 3,
            policyVersion: 'fanout-v1',
            disagreementMetric: 'choice-disagreement-rate',
            stoppingRule: 'fixed-three-no-retry',
          }
        : {
            requested: false,
            eligible: false,
            calls: 1,
            policyVersion: null,
            disagreementMetric: null,
            stoppingRule: null,
          },
    },
  };
}

const singleDecision = routeJevQuestion(candidate());
assert.equal(singleDecision.route, 'single-live');

const pending = freezeFakeJevExecutionObservation({
  decision: singleDecision,
  attempts: [{
    index: 0,
    status: 'answered',
    answerSha256: 'c'.repeat(64),
    errorCode: null,
    inputTokens: 100,
    outputTokens: 20,
    latencyMs: 40,
    cost: {
      amount: 0.002,
      currency: 'USD',
      rateEvidence: 'fake-rate-v1',
    },
    providerConfidence: 0.8,
  }],
  wallMs: 45,
  evaluation: {
    status: 'pending',
    methodId: 'independent-eval-v1',
  },
  downstreamRecommendationChanged: true,
});
validateFakeJevExecutionObservation(pending, { decision: singleDecision });

const pendingLedger = buildJevUtilityLedger([pending]);
assert.equal(pendingLedger.counts.providerRequests, 1);
assert.equal(pendingLedger.counts.answered, 1);
assert.equal(pendingLedger.counts.resolvedEvaluableQuestions, 0);
assert.equal(pendingLedger.utility.resolvedEvaluableQuestionsPerProviderToken, 0);
assert.equal(pendingLedger.utility.informationGain, null);
assert.equal(pendingLedger.utility.falseConfidenceCases, null);

const confirmed = freezeFakeJevExecutionObservation({
  decision: singleDecision,
  attempts: pending.attempts,
  wallMs: 45,
  evaluation: {
    status: 'confirmed',
    methodId: 'independent-eval-v1',
  },
  downstreamRecommendationChanged: true,
});

const fanoutDecision = routeJevQuestion(candidate({ fanout: true }));
assert.equal(fanoutDecision.route, 'fanout-live');
assert.equal(fanoutDecision.plannedLiveQuestions, 3);

const fanout = freezeFakeJevExecutionObservation({
  decision: fanoutDecision,
  provider: 'fake-provider',
  model: 'fake-model',
  attempts: [
    {
      index: 0,
      status: 'answered',
      answerSha256: 'd'.repeat(64),
      errorCode: null,
      inputTokens: 50,
      outputTokens: 10,
      latencyMs: 20,
      cost: { amount: 0.001, currency: 'USD', rateEvidence: 'fake-rate-v1' },
      providerConfidence: 0.7,
    },
    {
      index: 1,
      status: 'insufficient',
      answerSha256: 'e'.repeat(64),
      errorCode: null,
      inputTokens: 40,
      outputTokens: 5,
      latencyMs: 25,
      cost: { amount: 0.001, currency: 'USD', rateEvidence: 'fake-rate-v1' },
      providerConfidence: 0.55,
    },
    {
      index: 2,
      status: 'error',
      answerSha256: null,
      errorCode: 'synthetic_transport',
      inputTokens: 20,
      outputTokens: 0,
      latencyMs: 10,
      cost: { amount: 0.001, currency: 'USD', rateEvidence: 'fake-rate-v1' },
      providerConfidence: null,
    },
  ],
  wallMs: 30,
  evaluation: {
    status: 'rejected',
    methodId: 'independent-eval-v1',
  },
  downstreamRecommendationChanged: false,
});

const deterministicCandidate = candidate();
deterministicCandidate.deterministic = {
  available: true,
  resolutionSha256: 'f'.repeat(64),
};
const deterministicDecision = routeJevQuestion(deterministicCandidate);
const deterministic = freezeFakeJevExecutionObservation({
  decision: deterministicDecision,
  attempts: [],
  wallMs: 2,
  downstreamRecommendationChanged: false,
});
assert.equal(deterministic.evaluation.status, 'not-applicable');

const ledger = buildJevUtilityLedger([confirmed, fanout, deterministic]);
assert.equal(ledger.counts.observations, 3);
assert.equal(ledger.counts.deterministic, 1);
assert.equal(ledger.counts.singleLive, 1);
assert.equal(ledger.counts.fanoutLive, 1);
assert.equal(ledger.counts.providerRequests, 4);
assert.equal(ledger.counts.answered, 2);
assert.equal(ledger.counts.insufficient, 1);
assert.equal(ledger.counts.error, 1);
assert.equal(ledger.counts.evaluationConfirmed, 1);
assert.equal(ledger.counts.evaluationRejected, 1);
assert.equal(ledger.counts.resolvedEvaluableQuestions, 2);
assert.equal(ledger.counts.downstreamRecommendationChanged, 1);
assert.equal(ledger.usage.inputTokens, 210);
assert.equal(ledger.usage.outputTokens, 35);
assert.equal(ledger.usage.totalProviderTokens, 245);
assert.equal(ledger.usage.costByCurrency.length, 1);
assert.equal(ledger.usage.costByCurrency[0].currency, 'USD');
assert.equal(ledger.usage.costByCurrency[0].amount, 0.005);
assert.equal(ledger.usage.costByCurrency[0].costPerResolvedUncertainty, 0.0025);
assert.equal(ledger.utility.resolvedEvaluableQuestionsPerProviderToken, 2 / 245);
assert.equal(ledger.utility.informationGain, null);

const overCost = structuredClone(fanout.attempts);
overCost[0].cost.amount = 0.02;
assert.throws(
  () => freezeFakeJevExecutionObservation({
    decision: fanoutDecision,
    attempts: overCost,
    wallMs: 30,
    evaluation: { status: 'pending', methodId: 'independent-eval-v1' },
  }),
  /cost exceeds monetary ceiling/,
);

assert.throws(
  () => freezeFakeJevExecutionObservation({
    decision: fanoutDecision,
    attempts: fanout.attempts.slice(0, 2),
    wallMs: 30,
    evaluation: { status: 'pending', methodId: 'independent-eval-v1' },
  }),
  /attempt count must equal planned live questions/,
);

const tampered = structuredClone(confirmed);
tampered.wallMs = 999;
assert.throws(
  () => validateFakeJevExecutionObservation(tampered, { decision: singleDecision }),
  /fake observation digest mismatch/,
);

assert.throws(
  () => buildJevUtilityLedger([confirmed, confirmed]),
  /duplicate Jev utility observation/,
);

console.log('Jev utility ledger: fake route execution, provider-budget enforcement, evaluation-gated resolution and exact utility denominators PASS');
