import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { evaluatePerformanceRegression } from '../src/perf/regression-gate.mjs';

const contract = JSON.parse(await readFile(
  new URL('../perf/PERF_THRESHOLDS.v1.json', import.meta.url),
  'utf8',
));

const good = {
  measurements: {
    inventory: { repeatP95Ms: 700 },
    history: { warmHitMs: 8 },
    syntheticScale: { impactP95Ms: 14, discoveryP95Ms: 10 },
    scipTypescript: {
      status: 'measured',
      exactContentWarmHitMs: 7,
      firstIndexMs: 9000,
      repeatH19CacheMissMs: 8500,
      singleFileChange: { reindexMs: 8400 },
      projectShards: {
        coldVsMonolithicRatio: 1.1,
        warmHitTotalMs: 9,
        singleFileChange: {
          status: 'measured',
          totalMs: 5600,
          misses: 1,
          hits: 2,
        },
      },
    },
  },
};

const accepted = evaluatePerformanceRegression(good, contract);
assert.equal(accepted.pass, true);
assert.equal(accepted.productTargetsFrozen, false);

const slowShard = structuredClone(good);
slowShard.measurements.scipTypescript.projectShards.singleFileChange.totalMs = 8000;
const rejectedShard = evaluatePerformanceRegression(slowShard, contract);
assert.equal(rejectedShard.pass, false);
assert.equal(
  rejectedShard.checks.find((x) => x.id === 'scip.sharded-change-vs-monolithic-ratio')?.ok,
  false,
);

const lostReuse = structuredClone(good);
lostReuse.measurements.scipTypescript.projectShards.singleFileChange = {
  status: 'measured',
  totalMs: 5600,
  misses: 3,
  hits: 0,
};
const rejectedReuse = evaluatePerformanceRegression(lostReuse, contract);
assert.equal(rejectedReuse.pass, false);
assert.equal(
  rejectedReuse.checks.find((x) => x.id === 'scip.sharded-change-hits')?.ok,
  false,
);

console.log('h19-kit performance regression gate smoke: ok');
