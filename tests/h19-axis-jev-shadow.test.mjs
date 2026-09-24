import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLeakageFree,
  assertPinnedModel,
  buildFactIdentity,
  buildJevRequest,
  canonicalJson,
  runH19AxisShadow,
  validateJevResponse,
} from '../scripts/run-h19-axis-jev-shadow.mjs';

const bank = {
  question_bank_id: 'DE-JEV-H19-AXIS',
  version: '0.1.0',
  axes: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].map((id) => ({ id, question: 'Question ' + id + '?' })),
};
const input = {
  case_key: 'C01',
  files: [{ path: 'supabase/migrations/example.sql', patch: '- old\n+ new' }],
};

test('benchmark runner rejects moving model aliases', () => {
  assert.throws(() => assertPinnedModel('jev-latest'), /must be pinned/);
  assert.equal(assertPinnedModel('jev-1.2.3'), 'jev-1.2.3');
});

test('request contains only sanitized state and six Noul questions', () => {
  const request = buildJevRequest(input, bank, 'jev-1.2.3');
  assert.deepEqual(request.state, { files: input.files });
  assert.deepEqual(Object.keys(request.questions), ['D0', 'D1', 'D2', 'D3', 'D4', 'D5']);
  assert.ok(Object.values(request.questions).every((question) => question.type === 'noul'));
  assert.equal(request.questions.D0.instructions, 'Question D0?');
});

test('leakage guard rejects H19 pair labels in model-visible state', () => {
  assert.doesNotThrow(() => assertLeakageFree({ files: input.files }));
  assert.throws(() => assertLeakageFree({ patch: 'D0 x D5 experimental branch' }), /leakage guard/);
  assert.throws(() => assertLeakageFree({ patch: 'EXP-H19 probe' }), /leakage guard/);
});

test('response validation reads Noul values directly and fences served-model drift', () => {
  const response = {
    model: 'jev-1.2.3',
    answers: Object.fromEntries(['D0', 'D1', 'D2', 'D3', 'D4', 'D5']
      .map((axis, index) => [axis, { type: 'noul', noul: index / 10 }])),
    usage: { input_tokens: 10, output_tokens: 6 },
  };
  assert.equal(validateJevResponse(response, 'jev-1.2.3').axis_probabilities.D5, 0.5);
  assert.throws(() => validateJevResponse({ ...response, model: 'jev-1.2.4' }, 'jev-1.2.3'), /served model differs/);
});

test('fact identity changes with input, question-bank digest or model version', () => {
  const base = { inputDigest: 'a', questionBank: bank, questionBankDigest: 'q1', model: 'jev-1.2.3' };
  const first = buildFactIdentity(base);
  assert.equal(first.fact_key, buildFactIdentity(base).fact_key);
  assert.notEqual(first.fact_key, buildFactIdentity({ ...base, inputDigest: 'b' }).fact_key);
  assert.notEqual(first.fact_key, buildFactIdentity({ ...base, questionBankDigest: 'q2' }).fact_key);
  assert.notEqual(first.fact_key, buildFactIdentity({ ...base, model: 'jev-1.2.4' }).fact_key);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test('second identical run is served from fact cache without a second model call', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        model: request.model,
        answers: Object.fromEntries(['D0', 'D1', 'D2', 'D3', 'D4', 'D5']
          .map((axis, index) => [axis, { type: 'noul', noul: 0.1 + index * 0.1 }])),
        usage: { input_tokens: 20, output_tokens: 6 },
      }),
    };
  };
  const cache = { version: 'DE-JEV-H19-R0-CACHE-0.1', entries: {} };
  const first = await runH19AxisShadow({
    inputs: { cases: [input] }, questionBank: bank, model: 'jev-1.2.3',
    cache, apiKey: 'fixture', fetchImpl,
  });
  assert.equal(first.receipt.live_calls, 1);
  assert.equal(first.facts.cases[0].cache_hit, false);
  const second = await runH19AxisShadow({
    inputs: { cases: [input] }, questionBank: bank, model: 'jev-1.2.3',
    cache: first.cache, apiKey: null, fetchImpl,
  });
  assert.equal(second.receipt.cache_hits, 1);
  assert.equal(second.facts.cases[0].cache_hit, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.facts.cases[0].axis_probabilities, first.facts.cases[0].axis_probabilities);
});
