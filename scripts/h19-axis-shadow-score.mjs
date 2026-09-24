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

export function axisYesProbability(fact) {
  if (!fact || typeof fact !== 'object') throw new Error('axis fact must be an object');
  if (typeof fact.answer !== 'boolean') throw new Error('axis fact answer must be boolean');
  if (typeof fact.confidence !== 'number' || !Number.isFinite(fact.confidence)
    || fact.confidence < 0 || fact.confidence > 1) {
    throw new Error('axis fact confidence must be a finite number in [0,1]');
  }
  return fact.answer ? fact.confidence : 1 - fact.confidence;
}

function normalizeAxisFacts(axisFacts) {
  if (!axisFacts || typeof axisFacts !== 'object') throw new Error('axisFacts must be an object');
  return Object.fromEntries(H19_AXES.map((axis) => {
    if (!Object.prototype.hasOwnProperty.call(axisFacts, axis)) {
      throw new Error('missing H19 axis fact: ' + axis);
    }
    return [axis, axisYesProbability(axisFacts[axis])];
  }));
}

export function rankH19Pairs(axisFacts) {
  const probabilities = normalizeAxisFacts(axisFacts);
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
  if (!Array.isArray(record.expectedPair) || record.expectedPair.length !== 2) {
    throw new Error('benchmark record ' + record.id + ' expectedPair must contain two axes');
  }
  if (!['prospective', 'holdout'].includes(record.origin)) {
    throw new Error('benchmark record ' + record.id + ' origin must be prospective or holdout');
  }

  const expectedPair = normalizeH19Pair(record.expectedPair[0], record.expectedPair[1]);
  const ranking = rankH19Pairs(record.axisFacts);
  const index = ranking.findIndex((entry) => entry.pair === expectedPair);
  if (index < 0) throw new Error('benchmark record ' + record.id + ' expected pair was not ranked');
  const rank = index + 1;
  const topPair = ranking[0].pair;
  const frozenHoldoutExpected = H19_FROZEN_HOLDOUT_PAIRS.includes(expectedPair);

  return {
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
    frozenHoldoutExpected,
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
    scorerVersion: '0.1.0',
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

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node scripts/h19-axis-shadow-score.mjs <axis-facts.json>');
    process.exitCode = 2;
    return;
  }
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const records = Array.isArray(payload) ? payload : payload.records;
  process.stdout.write(JSON.stringify(scoreH19AxisBenchmark(records), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
