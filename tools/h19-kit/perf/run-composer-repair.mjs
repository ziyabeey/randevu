import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { composeRelationalCaseBatch } from '../src/relations/relational-case-composer.mjs';
import { selectionInput } from '../test/m9-selection-inputs.mjs';

// Optional baseline is a local copy of the pinned original selector, never a
// network/provider call. Both lanes use identical inputs in the same process.
const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath) throw new Error('usage: node run-composer-repair.mjs BASELINE_MODULE OUTPUT_JSON');
const baseline = (await import(pathToFileURL(resolve(baselinePath)).href)).composeRelationalCaseBatch;
const input = selectionInput(41, 24);
const measure = (compose, fixture) => {
  const start = performance.now();
  const result = compose(fixture);
  return { ms: performance.now() - start, batchSha256: result.batch.batchSha256 };
};
baseline(input); composeRelationalCaseBatch(input);
const runs = [];
for (let i = 0; i < 5; i += 1) {
  const a = i % 2 === 0 ? measure(baseline, input) : measure(composeRelationalCaseBatch, input);
  const b = i % 2 === 0 ? measure(composeRelationalCaseBatch, input) : measure(baseline, input);
  if (a.batchSha256 !== b.batchSha256) throw new Error('selection equivalence mismatch');
  runs.push(i % 2 === 0 ? { baseline: a, repaired: b } : { baseline: b, repaired: a });
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const baselineMs = median(runs.map((run) => run.baseline.ms));
const repairedMs = median(runs.map((run) => run.repaired.ms));
const wide = selectionInput(41, 100);
wide.factPool = wide.factPool.filter((_, index) => index % 4 !== 3);
for (const [index, entry] of wide.factPool.entries()) {
  entry.fact = { ...entry.fact, factId: `wide:${String(index).padStart(3, '0')}`,
    family: index === 0 ? 'coverage' : 'history', lineageIds: [`wide:${index}`] };
  entry.scope = { kind: 'path', path: 'src/a.ts' };
}
const report = {
  benchmarkId: 'M9-REPAIR-001', baselineCommit: '3ca0c03693023b605caac59c11fad8a9cbad52a3',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  fixture: { seed: 41, normalizedFacts: 24, repeats: 5, warmupPerLane: 1, alternatingOrder: true },
  runs, medians: { baselineMs, repairedMs, speedup: baselineMs / repairedMs },
  widePool: { eligibleFacts: wide.factPool.length, ...measure(composeRelationalCaseBatch, wide) },
  limits: ['Synthetic local selector-only measurement; no provider or end-to-end CI claim.',
    'Exact search retains worst-case combinatorial CPU cost; candidate arrays are no longer materialized.',
    'Overflow uses existence search; invalid overflow reasons remain unchanged.'],
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.medians, widePool: report.widePool }));
