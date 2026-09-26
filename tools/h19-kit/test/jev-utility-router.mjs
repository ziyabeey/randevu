import assert from 'node:assert/strict';

import {
  routeJevQuestion,
  validateJevQuestionCandidate,
  validateJevRouteDecision,
} from '../src/routing/jev-utility-router.mjs';

function baseCandidate() {
  return {
    schemaVersion: 1,
    kind: 'h19-jev-question-candidate',
    question: {
      id: 'RELATION_DIRECTION',
      version: '0.1',
      class: 'relation-judgment',
      inputSha256: 'a'.repeat(64),
    },
    evidence: {
      completeness: 'partial',
      unknownCount: 1,
      conflictCount: 0,
      lineageOverlap: false,
    },
    deterministic: {
      available: false,
      resolutionSha256: null,
    },
    cache: {
      status: 'miss',
      cacheKey: 'relation:test',
      answerSha256: null,
    },
    live: {
      allowed: true,
      maxLiveQuestions: 3,
      maxInputTokens: 4096,
      maxOutputTokens: 512,
      monetaryCeiling: {
        amount: 0.05,
        currency: 'USD',
        rateEvidence: 'synthetic-rate-fixture-v1',
      },
      timeoutMs: 30_000,
      evaluationMethodId: 'synthetic-independent-evaluation-v1',
      fanout: {
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

const single = routeJevQuestion(baseCandidate());
assert.equal(single.route, 'single-live');
assert.equal(single.reasonCode, 'bounded-live-question-eligible');
assert.equal(single.plannedLiveQuestions, 1);
assert.equal(single.liveExecutionPerformed, false);
assert.equal(single.authority, 'advisory');
validateJevRouteDecision(single, { candidate: baseCandidate() });

const deterministicCandidate = baseCandidate();
deterministicCandidate.deterministic = {
  available: true,
  resolutionSha256: 'b'.repeat(64),
};
deterministicCandidate.cache = {
  status: 'invalid',
  cacheKey: 'corrupt',
  answerSha256: null,
};
const deterministic = routeJevQuestion(deterministicCandidate);
assert.equal(deterministic.route, 'deterministic');
assert.equal(deterministic.plannedLiveQuestions, 0);

const cachedCandidate = baseCandidate();
cachedCandidate.evidence.completeness = 'insufficient';
cachedCandidate.cache = {
  status: 'hit',
  cacheKey: 'exact-key',
  answerSha256: 'c'.repeat(64),
};
const cached = routeJevQuestion(cachedCandidate);
assert.equal(cached.route, 'cache');
assert.equal(cached.reasonCode, 'exact-cache-hit');
assert.equal(cached.plannedLiveQuestions, 0);

const invalidCache = baseCandidate();
invalidCache.cache = {
  status: 'invalid',
  cacheKey: 'bad-key',
  answerSha256: 'd'.repeat(64),
};
assert.equal(routeJevQuestion(invalidCache).reasonCode, 'invalid-cache-fail-closed');

const insufficient = baseCandidate();
insufficient.evidence.completeness = 'insufficient';
assert.equal(routeJevQuestion(insufficient).reasonCode, 'evidence-insufficient');

const noEvaluation = baseCandidate();
noEvaluation.live.evaluationMethodId = null;
assert.equal(routeJevQuestion(noEvaluation).reasonCode, 'evaluation-contract-missing');

const disabled = baseCandidate();
disabled.live.allowed = false;
disabled.live.maxLiveQuestions = 0;
assert.equal(routeJevQuestion(disabled).reasonCode, 'live-provider-disabled');

const tokenless = baseCandidate();
tokenless.live.maxInputTokens = 0;
assert.equal(routeJevQuestion(tokenless).reasonCode, 'live-token-budget-zero');

const noMoney = baseCandidate();
noMoney.live.monetaryCeiling = null;
assert.equal(routeJevQuestion(noMoney).reasonCode, 'monetary-ceiling-missing');

const zeroMoney = baseCandidate();
zeroMoney.live.monetaryCeiling.amount = 0;
assert.equal(routeJevQuestion(zeroMoney).reasonCode, 'monetary-ceiling-zero');

const fanout = baseCandidate();
fanout.live.maxLiveQuestions = 4;
fanout.live.fanout = {
  requested: true,
  eligible: true,
  calls: 3,
  policyVersion: 'fanout-v1',
  disagreementMetric: 'choice-disagreement-rate',
  stoppingRule: 'fixed-three-no-retry',
};
const fanoutDecision = routeJevQuestion(fanout);
assert.equal(fanoutDecision.route, 'fanout-live');
assert.equal(fanoutDecision.reasonCode, 'prospective-fanout-authorized');
assert.equal(fanoutDecision.plannedLiveQuestions, 3);

const fanoutOverflow = structuredClone(fanout);
fanoutOverflow.live.maxLiveQuestions = 2;
const overflowDecision = routeJevQuestion(fanoutOverflow);
assert.equal(overflowDecision.route, 'abstain');
assert.equal(overflowDecision.reasonCode, 'fanout-budget-exceeded');
assert.equal(overflowDecision.plannedLiveQuestions, 0);

const fanoutNotEligible = structuredClone(fanout);
fanoutNotEligible.live.fanout.eligible = false;
const fallbackDecision = routeJevQuestion(fanoutNotEligible);
assert.equal(fallbackDecision.route, 'single-live');
assert.equal(fallbackDecision.reasonCode, 'fanout-not-eligible-single-fallback');
assert.equal(fallbackDecision.plannedLiveQuestions, 1);

const degenerateFanout = structuredClone(fanout);
degenerateFanout.live.fanout.calls = 1;
const degenerateDecision = routeJevQuestion(degenerateFanout);
assert.equal(degenerateDecision.route, 'single-live');
assert.equal(degenerateDecision.reasonCode, 'fanout-degenerate-single');

const replayA = routeJevQuestion(baseCandidate());
const replayB = routeJevQuestion(structuredClone(baseCandidate()));
assert.deepEqual(replayA, replayB);
assert.match(replayA.candidateSha256, /^[a-f0-9]{64}$/);

const candidateDrift = baseCandidate();
candidateDrift.evidence.unknownCount = 2;
assert.notEqual(
  routeJevQuestion(candidateDrift).candidateSha256,
  replayA.candidateSha256,
  'candidate identity must change when routing evidence changes',
);

const tampered = structuredClone(replayA);
tampered.reasonCode = 'tampered';
assert.throws(
  () => validateJevRouteDecision(tampered, { candidate: baseCandidate() }),
  /route decision digest mismatch/,
);

const invalidQuestion = baseCandidate();
invalidQuestion.question.class = 'write-production-code';
assert.throws(
  () => validateJevQuestionCandidate(invalidQuestion),
  /unsupported Jev question class/,
);

const invalidDisabledBudget = baseCandidate();
invalidDisabledBudget.live.allowed = false;
assert.throws(
  () => validateJevQuestionCandidate(invalidDisabledBudget),
  /disabled live route must have zero live-question budget/,
);

console.log('Jev utility router: deterministic/cache precedence, fail-closed abstention, bounded single/fanout planning and content-addressed replay PASS');
