import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const AXES = [
  'authorization_tenant',
  'atomicity_idempotency',
  'snapshot_price_policy',
  'staff_capacity',
  'time_buffer_boundary',
  'concurrency_version',
];

const N = AXES.length;
const CENTER = Object.freeze(Array(N).fill(0));

function row(...active) {
  const value = Array(N).fill(0);
  for (const index of active) value[index] = 1;
  return Object.freeze(value);
}

const SINGLES = Object.freeze(Array.from({ length: N }, (_, index) => row(index)));

function cyclicPairs(distance) {
  const seen = new Set();
  const pairs = [];
  for (let i = 0; i < N; i += 1) {
    const j = (i + distance) % N;
    const pair = [Math.min(i, j), Math.max(i, j)];
    const key = pair.join(':');
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push(Object.freeze(pair));
    }
  }
  return pairs;
}

const DISTANCE_1 = Object.freeze(cyclicPairs(1));
const DISTANCE_2 = Object.freeze(cyclicPairs(2));
const HOLDOUT = Object.freeze(cyclicPairs(3));
const H19_PAIRS = Object.freeze([...DISTANCE_1, ...DISTANCE_2]);
const H19_SUITE = Object.freeze([
  CENTER,
  ...SINGLES,
  ...H19_PAIRS.map(([a, b]) => row(a, b)),
]);

function combinations(values, size, start = 0, prefix = [], out = []) {
  if (prefix.length === size) {
    out.push([...prefix]);
    return out;
  }
  for (let i = start; i <= values.length - (size - prefix.length); i += 1) {
    prefix.push(values[i]);
    combinations(values, size, i + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

function assignments(size) {
  return Array.from({ length: 2 ** size }, (_, value) =>
    Array.from({ length: size }, (_, bit) => (value >> bit) & 1));
}

function interactionKey(indices, bits) {
  return `${indices.join(',')}|${bits.join('')}`;
}

function coveredInteractions(suite, strength) {
  const dimensions = combinations(Array.from({ length: N }, (_, index) => index), strength);
  const seen = new Set();
  for (const indices of dimensions) {
    for (const candidate of suite) {
      seen.add(interactionKey(indices, indices.map((index) => candidate[index])));
    }
  }
  return {
    covered: seen.size,
    total: dimensions.length * (2 ** strength),
  };
}

function randomExpectedCoverage(strength, suiteSize) {
  return 1 - ((1 - (2 ** (-strength))) ** suiteSize);
}

function rowFromInteger(value) {
  return Array.from({ length: N }, (_, bit) => (value >> bit) & 1);
}

function interactionsForRow(candidate, strength) {
  return new Set(combinations(Array.from({ length: N }, (_, index) => index), strength)
    .map((indices) => interactionKey(indices, indices.map((index) => candidate[index]))));
}

function allInteractions(strength) {
  const result = new Set();
  for (const indices of combinations(Array.from({ length: N }, (_, index) => index), strength)) {
    for (const bits of assignments(strength)) result.add(interactionKey(indices, bits));
  }
  return result;
}

// Same 19-row budget. Selection is deterministic: maximize uncovered pairwise
// interactions first, then strength 3..6; numeric row value breaks exact ties.
function greedyCombinatorialSuite(size = 19) {
  const strengths = [2, 3, 4, 5, 6];
  const uncovered = new Map(strengths.map((strength) => [strength, allInteractions(strength)]));
  const remaining = new Set(Array.from({ length: 64 }, (_, value) => value));
  const suite = [];

  while (suite.length < size) {
    let bestValue = null;
    let bestScore = null;

    for (const value of remaining) {
      const candidate = rowFromInteger(value);
      const score = strengths.map((strength) => {
        let gain = 0;
        const open = uncovered.get(strength);
        for (const key of interactionsForRow(candidate, strength)) if (open.has(key)) gain += 1;
        return gain;
      });

      const isBetter = bestScore === null
        || score.some((entry, index) =>
          entry > bestScore[index] && score.slice(0, index).every((prior, i) => prior === bestScore[i]))
        || (score.every((entry, index) => entry === bestScore[index]) && value < bestValue);

      if (isBetter) {
        bestValue = value;
        bestScore = score;
      }
    }

    const chosen = rowFromInteger(bestValue);
    suite.push(chosen);
    remaining.delete(bestValue);

    for (const strength of strengths) {
      const open = uncovered.get(strength);
      for (const key of interactionsForRow(chosen, strength)) open.delete(key);
    }
  }

  return suite;
}

test('H19 T5-B matrix is frozen as center + six singles + twelve cyclic distance-1/2 pairs', () => {
  assert.equal(H19_SUITE.length, 19);
  assert.equal(SINGLES.length, 6);
  assert.equal(H19_PAIRS.length, 12);
  assert.equal(HOLDOUT.length, 3);

  const h19Keys = new Set(H19_PAIRS.map((pair) => pair.join(':')));
  const holdoutKeys = new Set(HOLDOUT.map((pair) => pair.join(':')));
  assert.equal(h19Keys.size, 12);
  assert.equal(holdoutKeys.size, 3);
  for (const key of holdoutKeys) assert.equal(h19Keys.has(key), false);

  const everyPair = new Set([...h19Keys, ...holdoutKeys]);
  assert.equal(everyPair.size, 15);
});

test('H19 frozen suite has exact combinatorial coverage and does not masquerade as a pairwise replacement', () => {
  assert.deepEqual(coveredInteractions(H19_SUITE, 1), { covered: 12, total: 12 });
  assert.deepEqual(coveredInteractions(H19_SUITE, 2), { covered: 57, total: 60 });
  assert.deepEqual(coveredInteractions(H19_SUITE, 3), { covered: 128, total: 160 });
  assert.deepEqual(coveredInteractions(H19_SUITE, 4), { covered: 147, total: 240 });

  // Analytic expected assignment coverage for 19 independent uniform random rows.
  assert.ok(randomExpectedCoverage(2, 19) > 57 / 60);
  assert.ok(randomExpectedCoverage(3, 19) > 128 / 160);
  assert.ok(randomExpectedCoverage(4, 19) > 147 / 240);

  const greedy = greedyCombinatorialSuite(19);
  assert.deepEqual(coveredInteractions(greedy, 2), { covered: 60, total: 60 });
  assert.deepEqual(coveredInteractions(greedy, 3), { covered: 160, total: 160 });
  assert.deepEqual(coveredInteractions(greedy, 4), { covered: 221, total: 240 });
});

test('H19 exact low-order fault geometry is explicit: all singles, 12/15 doubles, three antipodal holdouts', () => {
  assert.equal(SINGLES.length, 6);
  assert.equal(H19_PAIRS.length, 12);
  assert.equal(HOLDOUT.length, 3);

  assert.deepEqual(HOLDOUT, [[0, 3], [1, 4], [2, 5]]);
});

test('Kepenk F11 evidence preserves the preregistered snapshot/concurrency holdout', () => {
  const priceRace = readFileSync(new URL('../supabase/tests/f11_price_snapshot_concurrency.sql', import.meta.url), 'utf8');
  const createRace = readFileSync(new URL('../supabase/tests/f11_group_create_concurrency.sql', import.meta.url), 'utf8');
  const authorityRace = readFileSync(new URL('../supabase/tests/f11_schedule_authority_races.sql', import.meta.url), 'utf8');
  const finalBinding = readFileSync(new URL('../supabase/tests/f11_final_binding.sql', import.meta.url), 'utf8');

  assert.match(priceRace, /SERVICE_PRICE_SNAPSHOT_MISMATCH/);
  assert.match(priceRace, /appointment after snapshot mismatch/);
  assert.match(createRace, /exactly one winner/);
  assert.match(createRace, /half group/);
  assert.match(authorityRace, /schedule authority races accepted/);
  assert.match(finalBinding, /processingCapacityPolicy/);
});
