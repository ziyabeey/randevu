import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { m11Digest, m11SourceBlobSha } from '../src/experiments/m11-materializer.mjs';
import { summarizeM11V8Coverage } from '../src/experiments/m11-collection.mjs';
import { validateM11TargetedInputs, interpretM11TargetedRun } from '../src/experiments/m11-targeted-validation.mjs';
import { validateRelationalOutcome } from '../src/relations/relational-evidence.mjs';

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const [plan, saved, bridge, collection, closure, snapshot, inventory] = await Promise.all([
  'validation-001/PLAN.json', 'validation-001/RESULT.json', 'DEVELOPMENT-BRIDGE-001.json',
  'DEVELOPMENT-COLLECTION-001.json', 'REPOSITORY-CLOSURE-001.json', 'SOURCE-SNAPSHOT-001.json', 'COHORT-v0.2.json',
].map(load));
const inputs = { plan, expectedPlanSha256: '77d82b1ee762f86bf679236eaf0b3b6331e80598ea0232289e76b42972a38f4a',
  bridge, collection, closure, snapshot, inventory };
const valid = validateM11TargetedInputs(inputs);
assert.deepEqual(interpretM11TargetedRun(inputs, saved.run), saved);
assert.equal(saved.validation.status, 'confirmed');
assert.equal(saved.run.testSummary.pass, 7);
assert.equal(saved.counts.newCallsToOriginalUncalledEntries, 4);
assert.equal(saved.counts.functionalDefectsEstablished, 0);
assert.equal(saved.outcome.judgmentSha256, null);
assert(Object.isFrozen(interpretM11TargetedRun(inputs, saved.run).validation.observed.gapChecks));
validateRelationalOutcome(saved.outcome, { relationalCase: valid.relationalCase });
assert.deepEqual(valid.lineage.evaluationOverlap, []);
assert.equal(valid.lineage.additionalDevelopmentPaths.length, 2);
assert(saved.run.observationSha256 !== plan.baselineObservationSha256);
assert.equal(m11SourceBlobSha(await readFile(new URL(plan.candidate.path, dir))), plan.candidate.gitBlobSha);
for (const [p, sha] of Object.entries(plan.producerBindings)) {
  assert.equal(m11SourceBlobSha(await readFile(new URL('../' + p, import.meta.url))), sha, 'frozen execution producer changed');
}

// Derive coverage union from the two actual raw V8 measurements, not by adding
// counts. validTimestamp is shared; five old + five new distinct calls total nine.
const baseline = collection.runs.find((r) => r.observationSha256 === plan.baselineObservationSha256);
const oldTarget = baseline.targets.find((t) => t.path === plan.targetPath);
const union = summarizeM11V8Coverage([...oldTarget.v8Entries, ...saved.run.target.v8Entries]);
assert.equal(union.observedNamedFunctions, 9); assert.equal(union.calledNamedFunctions, 9);
assert.equal(union.uncalledNamedFunctions.length, 0);
assert.equal(oldTarget.coverage.calledNamedFunctions, 5);
assert.equal(saved.run.target.coverage.calledNamedFunctions, 5);

const seal = (x, key) => { const { [key]: ignored, ...body } = x; return { ...body, [key]: m11Digest(body) }; };
const withRun = (edit) => { const run = structuredClone(saved.run); edit(run); return seal(run, 'observationSha256'); };
for (const edit of [
  (r) => { r.completed = false; r.exitCode = null; },
  (r) => { r.target.v8Entries = []; r.target.coverage = summarizeM11V8Coverage([]); },
  (r) => { r.stdout = r.stdout.replace('# Subtest: V01', '# Subtest: OTHER'); },
  (r) => {
    for (const script of r.target.v8Entries) for (const f of script.functions) {
      if (f.functionName === 'validDate') f.ranges[0].count = 0;
    }
    r.target.coverage = summarizeM11V8Coverage(r.target.v8Entries);
  },
]) {
  const result = interpretM11TargetedRun(inputs, withRun(edit));
  assert.equal(result.validation.status, 'inconclusive');
  assert.equal(result.outcome.value, 'inconclusive');
  assert.equal(result.counts.confirmedCoverageGaps, 0);
}
const corruptions = [
  [(r) => { r.planSha256 = '0'.repeat(64); }, /run input identity/],
  [(r) => { r.target.gitBlobSha = '0'.repeat(40); }, /coverage source/],
  [(r) => { r.testSummary.pass = 8; }, /TAP summary/],
  [(r) => { r.target.coverage.calledNamedFunctions = 9; }, /V8 summary/],
  [(r) => { r.startedAt = '2020-01-01T00:00:00.000Z'; }, /precedes plan/],
  [(r) => { r.timings.executionMs = -1; }, /timings/],
  [(r) => { r.producerBindings = {}; }, /producer identity/],
];
for (const [edit, expected] of corruptions) assert.throws(() => interpretM11TargetedRun(inputs, withRun(edit)), expected);
assert.throws(() => interpretM11TargetedRun(inputs, { ...saved.run, exitCode: 1 }), /observationSha256 identity/);
assert.throws(() => validateM11TargetedInputs({ ...inputs, expectedPlanSha256: '0'.repeat(64) }), /planSha256 identity/);
for (const [edit, expected] of [
  [(p) => { p.caseSha256 = '0'.repeat(64); }, /case missing/],
  [(p) => { p.requiredEntries.pop(); }, /gap entries/],
  [(p) => { p.sourceBindings = {}; }, /dependency closure/],
  [(p) => { p.oracleBindings['src/calendar-refresh.ts'] = inventory.metadata.sources['src/calendar-refresh.ts'].gitBlobSha; }, /evaluation boundary/],
]) {
  const p = structuredClone(plan); edit(p); const frozen = seal(p, 'planSha256');
  assert.throws(() => validateM11TargetedInputs({ ...inputs, plan: frozen, expectedPlanSha256: frozen.planSha256 }), expected);
}

// Invalid CLI plan identity fails before source copying or execution. The real
// seven-scenario run remains the single retained empirical run, never rerun here.
const cli = fileURLToPath(new URL('../bin/h19-m11-validate.mjs', import.meta.url));
const failed = spawnSync(process.execPath, [cli, fileURLToPath(dir), fileURLToPath(new URL('validation-001/PLAN.json', dir)),
  '0'.repeat(64), '/nonexistent-source-must-not-be-read'], { encoding: 'utf8', timeout: 20000 });
assert.notEqual(failed.status, 0); assert.equal(failed.stdout, ''); assert.match(failed.stderr, /planSha256 identity/);
console.log('M11 targeted validation: seven recorded passes, 4 newly called entries, 9/9 named-entry union, outcome replay and inconclusive/identity boundaries PASS');
