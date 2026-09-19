import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCaseFingerprint,
  buildEscalationEnvelope,
  buildRoutineFireBody,
  classifyEscalationDisposition,
  renderHaikuCompressionRequest,
} from '../scripts/development-escalation-envelope.mjs';

const sha = (char) => char.repeat(40);
const head = sha('a');
const main = sha('b');

function dispatcher(action, overrides = {}) {
  return {
    facts: {
      task: { id: 'F12-04C' },
      candidate: { taskId: 'F12-04C', prNumber: 176, branch: 'f12-04c', headSha: head },
      observation: { liveMainSha: main, observedMainSha: main },
    },
    state: { ci: { result: 'pass' }, reviews: { r1: { status: 'stale' } } },
    contradictions: [],
    unknowns: [],
    obligations: [],
    recommendation: {
      kind: 'unique',
      nextActor: 'coordinator',
      suggestedAction: action,
      reasonCodes: [action.toUpperCase()],
      blockedBy: [],
      provenance: [],
    },
    sourceRefs: ['pr:176'],
    ...overrides,
  };
}

test('routing keeps deterministic work away from reasoning models', () => {
  assert.equal(classifyEscalationDisposition(dispatcher('request_required_reviews')).disposition, 'DETERMINISTIC_ACTION');
  assert.equal(classifyEscalationDisposition(dispatcher('wait_for_ci')).disposition, 'NO_ACTION');
  assert.equal(classifyEscalationDisposition(dispatcher('assess_current_evidence')).disposition, 'HUMAN_REQUIRED');
});

test('only bounded ambiguity enters reasoning tier', () => {
  assert.equal(classifyEscalationDisposition(dispatcher('resolve_contradictory_evidence')).disposition, 'REASONING_REQUIRED');
  assert.equal(classifyEscalationDisposition(dispatcher('investigate_current_ci_failure')).disposition, 'REASONING_REQUIRED');
  assert.equal(classifyEscalationDisposition(dispatcher('confirm_docs_only_delta')).disposition, 'REASONING_REQUIRED');
});

test('unknown dispatcher actions fail closed to human rather than spending model credit', () => {
  const result = classifyEscalationDisposition(dispatcher('future_unmapped_action'));
  assert.equal(result.disposition, 'HUMAN_REQUIRED');
  assert.match(result.reason, /^UNCLASSIFIED_DISPATCHER_ACTION:/);
});

test('envelope preserves exact identities, unknowns, contradictions and provenance', () => {
  const input = dispatcher('resolve_contradictory_evidence', {
    contradictions: ['MIXED_CURRENT_PROOF_STATUS:browser'],
    unknowns: ['R1_FRESHNESS_UNKNOWN'],
    obligations: [{ code: 'R1_REVIEW_REQUIRED', role: 'r1', source: 'r1', blocking: true }],
  });
  const envelope = buildEscalationEnvelope(input, {
    observedAt: '2026-09-19T09:00:00Z',
    escalationType: 'REVIEW_LINEAGE_AMBIGUITY',
    question: 'Fresh full R1 or bounded delta confirmation?',
    forbiddenScope: ['merge', 'TASKS write'],
    sourceRefs: ['review:123'],
    materialFacts: { exactHeadCi: 'PASS' },
  });

  assert.equal(envelope.disposition, 'REASONING_REQUIRED');
  assert.equal(envelope.case.pr, 176);
  assert.equal(envelope.case.currentHead, head);
  assert.equal(envelope.case.currentMain, main);
  assert.deepEqual(envelope.dispatcher.contradictions, ['MIXED_CURRENT_PROOF_STATUS:browser']);
  assert.deepEqual(envelope.evidence.sourceRefs, ['pr:176', 'review:123']);
  assert.equal(envelope.caseFingerprint.length, 64);
});

test('fingerprint is stable across ordering noise and changes on material evidence', () => {
  const input = dispatcher('investigate_current_ci_failure', {
    contradictions: ['B', 'A'],
    unknowns: ['Y', 'X'],
  });
  const first = buildCaseFingerprint(input, { sourceRefs: ['z', 'a'], materialFacts: { b: 2, a: 1 } });
  const second = buildCaseFingerprint({ ...input, contradictions: ['A', 'B'], unknowns: ['X', 'Y'] }, { sourceRefs: ['a', 'z'], materialFacts: { a: 1, b: 2 } });
  const changed = buildCaseFingerprint(input, { sourceRefs: ['z', 'a'], materialFacts: { b: 3, a: 1 } });
  const changedScope = buildCaseFingerprint(input, { sourceRefs: ['z', 'a'], materialFacts: { b: 2, a: 1 }, forbiddenScope: ['merge'] });
  const changedActions = buildCaseFingerprint(input, { sourceRefs: ['z', 'a'], materialFacts: { b: 2, a: 1 }, actionsAlreadyTaken: ['rerun-ci'] });
  const timestampOnly = buildCaseFingerprint(input, { sourceRefs: ['z', 'a'], materialFacts: { b: 2, a: 1 }, observedAt: '2026-09-19T10:00:00Z' });
  assert.equal(first, second);
  assert.equal(first, timestampOnly);
  assert.notEqual(first, changed);
  assert.notEqual(first, changedScope);
  assert.notEqual(first, changedActions);
});

test('Haiku request is refused for non-reasoning dispositions', () => {
  const envelope = buildEscalationEnvelope(dispatcher('request_required_reviews'));
  assert.throws(() => renderHaikuCompressionRequest(envelope), /REASONING_REQUIRED/);
});

test('Haiku request owns the Opus handoff without doing the Opus reasoning', () => {
  const envelope = buildEscalationEnvelope(dispatcher('investigate_current_ci_failure'), {
    question: 'Classify the ambiguous failure cause.',
  });
  const text = renderHaikuCompressionRequest(envelope);
  assert.match(text, /^EVIDENCE_COMPRESSION_REQUEST/);
  assert.match(text, /sole model layer authorized to trigger the Opus Escalation Governor/);
  assert.match(text, /Do not answer the technical question yourself/);
  assert.match(text, /node scripts\/fire-opus-escalation\.mjs --package/);
  assert.match(text, /Do not ask GitHub Actions, the dispatcher, or the caller to trigger Opus/);
  assert.match(text, /OPUS_HANDOFF_BLOCKED/);
  assert.match(text, new RegExp(head));
  assert.match(text, /investigate_current_ci_failure/);
});

test('routine fire body only carries text', () => {
  assert.deepEqual(buildRoutineFireBody('hello'), { text: 'hello' });
  assert.throws(() => buildRoutineFireBody(''), /non-empty/);
});
