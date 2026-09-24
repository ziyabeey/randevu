import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const H19_AXES = Object.freeze(['D0', 'D1', 'D2', 'D3', 'D4', 'D5']);
export const H19_FROZEN_HOLDOUT_PAIRS = Object.freeze(['D0xD3', 'D1xD4', 'D2xD5']);

function assertAxis(axis) {
  if (!H19_AXES.includes(axis)) throw new Error('unknown H19 axis: ' + axis);
}

export function normalizeH19Pair(axisA, axisB) {
  assertAxis(axisA);
  assertAxis(axisB);
  if (axisA === axisB) throw new Error('H19 pair requires two distinct axes: ' + axisA);
  return [axisA, axisB].sort((left, right) => left.localeCompare(right, 'en')).join('x');
}

export function axisYesProbability(value) {
  const probability = typeof value === 'number' ? value : value?.noul;
  if (typeof probability !== 'number' || !Number.isFinite(probability)
    || probability < 0 || probability > 1) {
    throw new Error('axis probability must be a finite number in [0,1]');
  }
  return probability;
}

function normalizeAxisProbabilities(axisProbabilities) {
  if (!axisProbabilities || typeof axisProbabilities !== 'object') {
    throw new Error('axisProbabilities must be an object');
  }
  return Object.fromEntries(H19_AXES.map((axis) => {
    if (!Object.prototype.hasOwnProperty.call(axisProbabilities, axis)) {
      throw new Error('missing H19 axis probability: ' + axis);
    }
    return [axis, axisYesProbability(axisProbabilities[axis])];
  }));
}

export function rankH19Pairs(axisProbabilities) {
  const probabilities = normalizeAxisProbabilities(axisProbabilities);
  const pairs = [];
  for (let left = 0; left < H19_AXES.length; left += 1) {
    for (let right = left + 1; right < H19_AXES.length; right += 1) {
      const axisA = H19_AXES[left];
      const axisB = H19_AXES[right];
      const pair = normalizeH19Pair(axisA, axisB);
      pairs.push({
        pair,
        axisA,
        axisB,
        score: probabilities[axisA] * probabilities[axisB],
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.pair.localeCompare(b.pair, 'en'));
}

export function scoreH19AxisCase(record) {
  if (!record || typeof record !== 'object') throw new Error('benchmark record must be an object');
  if (typeof record.id !== 'string' || record.id.length === 0) throw new Error('benchmark record id is required');
  const expectedPairInput = record.expectedPair ?? record.expected_pair;
  if (!Array.isArray(expectedPairInput) || expectedPairInput.length !== 2) {
    throw new Error('benchmark record ' + record.id + ' expected pair must contain two axes');
  }
  if (!['prospective', 'holdout'].includes(record.origin)) {
    throw new Error('benchmark record ' + record.id + ' origin must be prospective or holdout');
  }

  const expectedPair = normalizeH19Pair(expectedPairInput[0], expectedPairInput[1]);
  const ranking = rankH19Pairs(record.axisProbabilities ?? record.axis_probabilities);
  const index = ranking.findIndex((entry) => entry.pair === expectedPair);
  if (index < 0) throw new Error('benchmark record ' + record.id + ' expected pair was not ranked');
  const rank = index + 1;
  const topPair = ranking[0].pair;

  return {
    caseKey: record.caseKey ?? record.case_key ?? null,
    id: record.id,
    origin: record.origin,
    expectedPair,
    expectedPairScore: ranking[index].score,
    rank,
    reciprocalRank: 1 / rank,
    top1Hit: rank === 1,
    top3Hit: rank <= 3,
    topPair,
    topPairIsFrozenHoldout: H19_FROZEN_HOLDOUT_PAIRS.includes(topPair),
    frozenHoldoutExpected: H19_FROZEN_HOLDOUT_PAIRS.includes(expectedPair),
  };
}

function summarize(rows) {
  if (rows.length === 0) {
    return { count: 0, top1Rate: null, top3Rate: null, meanReciprocalRank: null, meanExpectedPairScore: null };
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: rows.length,
    top1Rate: mean(rows.map((row) => Number(row.top1Hit))),
    top3Rate: mean(rows.map((row) => Number(row.top3Hit))),
    meanReciprocalRank: mean(rows.map((row) => row.reciprocalRank)),
    meanExpectedPairScore: mean(rows.map((row) => row.expectedPairScore)),
  };
}

export function scoreH19AxisBenchmark(records) {
  if (!Array.isArray(records)) throw new Error('benchmark input must be an array');
  const cases = records.map(scoreH19AxisCase);
  const prospective = cases.filter((row) => row.origin === 'prospective');
  const holdout = cases.filter((row) => row.origin === 'holdout');
  return {
    protocol: 'DE-JEV-H19-R0',
    scorerVersion: '0.2.0',
    metrics: {
      all: summarize(cases),
      prospective: summarize(prospective),
      holdout: summarize(holdout),
      prospectiveFrozenHoldoutTop1Rate: prospective.length === 0
        ? null
        : prospective.filter((row) => row.topPairIsFrozenHoldout).length / prospective.length,
    },
    cases,
  };
}

function uniqueCaseMap(cases, label) {
  if (!Array.isArray(cases)) throw new Error(label + ' cases must be an array');
  const map = new Map();
  for (const entry of cases) {
    const key = entry?.case_key;
    if (typeof key !== 'string' || key.length === 0) throw new Error(label + ' case_key is required');
    if (map.has(key)) throw new Error(label + ' duplicate case_key: ' + key);
    map.set(key, entry);
  }
  return map;
}

export function joinH19AxisFactsWithBenchmark(factsPayload, benchmarkPayload) {
  const facts = uniqueCaseMap(factsPayload?.cases, 'facts');
  const labels = uniqueCaseMap(benchmarkPayload?.cases, 'benchmark');
  if (Number.isInteger(benchmarkPayload?.case_count) && labels.size !== benchmarkPayload.case_count) {
    throw new Error('benchmark case_count mismatch');
  }
  if (facts.size !== labels.size) {
    throw new Error('facts/benchmark case count mismatch: facts=' + facts.size + ' benchmark=' + labels.size);
  }

  const joined = [];
  for (const [caseKey, label] of labels) {
    const fact = facts.get(caseKey);
    if (!fact) throw new Error('missing fact for benchmark case_key: ' + caseKey);
    joined.push({
      case_key: caseKey,
      id: label.id,
      origin: label.origin,
      expected_pair: label.expected_pair,
      axis_probabilities: fact.axis_probabilities,
    });
  }
  for (const caseKey of facts.keys()) {
    if (!labels.has(caseKey)) throw new Error('unexpected fact case_key: ' + caseKey);
  }
  return joined;
}

async function main() {
  const [factsPath, benchmarkPath] = process.argv.slice(2);
  if (!factsPath || !benchmarkPath) {
    console.error('usage: node scripts/h19-axis-shadow-score.mjs <facts.json> <benchmark.json>');
    process.exitCode = 2;
    return;
  }
  const [factsPayload, benchmarkPayload] = await Promise.all([
    readFile(factsPath, 'utf8').then(JSON.parse),
    readFile(benchmarkPath, 'utf8').then(JSON.parse),
  ]);
  const records = joinH19AxisFactsWithBenchmark(factsPayload, benchmarkPayload);
  process.stdout.write(JSON.stringify(scoreH19AxisBenchmark(records), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
