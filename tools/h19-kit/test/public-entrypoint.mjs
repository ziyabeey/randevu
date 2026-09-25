import assert from 'node:assert/strict';

const api = await import('../src/index.mjs');

for (const name of [
  'buildTypeScriptEvidenceGraph',
  'runProjectShardAdoptionBenchmark',
  'runGraphEquivalence',
  'resolveTypeScriptProjectShards',
  'analyzeChangeImpact',
  'discoverCoverageHypotheses',
  'buildRelationalJudgmentRequestPlan',
  'runRelationalJudgmentBatch',
  'validateRelationalJudgmentRun',
]) {
  assert.equal(typeof api[name], 'function', `missing public export: ${name}`);
}

console.log('h19-kit public entrypoint smoke: ok');
