import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisYesProbability,
  joinH19AxisFactsWithBenchmark,
  rankH19Pairs,
  scoreH19AxisBenchmark,
} from '../scripts/h19-axis-shadow-score.mjs';

const probabilities = ({ high = [], yes = 0.9, no = 0.1 } = {}) => Object.fromEntries(
  ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'].map((axis) => [axis, high.includes(axis) ? yes : no]),
);

test('native Noul probability is consumed directly', () => {
  assert.equal(axisYesProbability(0.8), 0.8);
  assert.equal(axisYesProbability({ noul: 0.2 }), 0.2);
  assert.throws(() => axisYesProbability(1.1), /\[0,1\]/);
});

test('pair ranking promotes the two strongest axis probabilities', () => {
  const ranking = rankH19Pairs(probabilities({ high: ['D0', 'D5'] }));
  assert.equal(ranking[0].pair, 'D0xD5');
});

test('benchmark metrics keep prospective and holdout cohorts separate', () => {
  const result = scoreH19AxisBenchmark([
    { id: 'p', origin: 'prospective', expected_pair: ['D0', 'D5'], axis_probabilities: probabilities({ high: ['D0', 'D5'] }) },
    { id: 'h', origin: 'holdout', expected_pair: ['D2', 'D5'], axis_probabilities: probabilities({ high: ['D2', 'D5'] }) },
  ]);
  assert.equal(result.metrics.all.count, 2);
  assert.equal(result.metrics.prospective.count, 1);
  assert.equal(result.metrics.holdout.count, 1);
  assert.equal(result.metrics.all.top1Rate, 1);
  assert.equal(result.metrics.prospectiveFrozenHoldoutTop1Rate, 0);
});

test('ties are deterministic', () => {
  const ranking = rankH19Pairs(probabilities({ high: [], yes: 0.5, no: 0.5 }));
  assert.equal(ranking[0].pair, 'D0xD1');
  assert.equal(ranking.at(-1).pair, 'D4xD5');
});

test('opaque case keys must form an exact one-to-one facts/label join', () => {
  const benchmark = {
    case_count: 2,
    cases: [
      { case_key: 'C02', id: 'two', origin: 'prospective', expected_pair: ['D0', 'D1'] },
      { case_key: 'C01', id: 'one', origin: 'holdout', expected_pair: ['D2', 'D5'] },
    ],
  };
  const facts = {
    cases: [
      { case_key: 'C01', axis_probabilities: probabilities({ high: ['D2', 'D5'] }) },
      { case_key: 'C02', axis_probabilities: probabilities({ high: ['D0', 'D1'] }) },
    ],
  };
  const joined = joinH19AxisFactsWithBenchmark(facts, benchmark);
  assert.deepEqual(joined.map((row) => [row.case_key, row.id]), [['C02', 'two'], ['C01', 'one']]);
  assert.throws(
    () => joinH19AxisFactsWithBenchmark({ cases: facts.cases.slice(0, 1) }, benchmark),
    /case count mismatch/,
  );
  assert.throws(
    () => joinH19AxisFactsWithBenchmark({ cases: [facts.cases[0], facts.cases[0]] }, benchmark),
    /duplicate case_key/,
  );
});
