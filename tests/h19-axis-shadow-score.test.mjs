import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisYesProbability,
  rankH19Pairs,
  scoreH19AxisBenchmark,
} from '../scripts/h19-axis-shadow-score.mjs';

const axisFacts = ({ yes = [], confidence = 0.9 } = {}) => Object.fromEntries(
  ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].map((axis) => [axis, {
    answer: yes.includes(axis),
    confidence,
  }]),
);

test('negative answer confidence is converted to deterministic yes probability', () => {
  assert.ok(Math.abs(axisYesProbability({ answer: false, confidence: 0.8 }) - 0.2) < 1e-12);
  assert.equal(axisYesProbability({ answer: true, confidence: 0.8 }), 0.8);
});

test('pair ranking promotes the two strongest axis facts', () => {
  const ranking = rankH19Pairs(axisFacts({ yes: ['D0', 'D5'] }));
  assert.equal(ranking[0].pair, 'D0xD5');
});

test('benchmark metrics keep prospective and holdout cohorts separate', () => {
  const result = scoreH19AxisBenchmark([
    { id: 'p', origin: 'prospective', expectedPair: ['D0', 'D5'], axisFacts: axisFacts({ yes: ['D0', 'D5'] }) },
    { id: 'h', origin: 'holdout', expectedPair: ['D2', 'D5'], axisFacts: axisFacts({ yes: ['D2', 'D5'] }) },
  ]);
  assert.equal(result.metrics.all.count, 2);
  assert.equal(result.metrics.prospective.count, 1);
  assert.equal(result.metrics.holdout.count, 1);
  assert.equal(result.metrics.all.top1Rate, 1);
  assert.equal(result.metrics.prospectiveFrozenHoldoutTop1Rate, 0);
});

test('ties are deterministic', () => {
  const ranking = rankH19Pairs(axisFacts({ yes: [], confidence: 0.5 }));
  assert.equal(ranking[0].pair, 'D0xD1');
  assert.equal(ranking.at(-1).pair, 'D4xD5');
});
