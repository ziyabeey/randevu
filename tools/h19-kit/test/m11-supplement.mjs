import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { m11Digest } from '../src/experiments/m11-materializer.mjs';
import { summarizeM11SupplementTap } from '../src/experiments/m11-supplement-collection.mjs';
import { deriveM11SupplementReceipts, materializeM11Supplement } from '../src/experiments/m11-supplement-bridge.mjs';

const dir = new URL('../experiments/m11/', import.meta.url), kit = new URL('../', import.meta.url);
const inputs = {};
for (const [k, n] of Object.entries({ originalInventory: 'COHORT-v0.1.json', inventory: 'COHORT-v0.2.json',
  snapshot: 'SOURCE-SNAPSHOT-001.json', closure: 'REPOSITORY-CLOSURE-001.json', recipe: 'COLLECTION-RECIPE-001.json',
  collection: 'DEVELOPMENT-COLLECTION-001.json', previousBridge: 'DEVELOPMENT-BRIDGE-001.json',
  plan: 'supplement-001/PLAN.json', staticAudit: 'supplement-001/STATIC-AUDIT.json', supplementalCollection: 'supplement-001/COLLECTION.json' })) {
  inputs[k] = JSON.parse(await readFile(new URL(n, dir), 'utf8'));
}
inputs.expectedPlanSha256 = 'a9a5450b1b0965d7e60caff6fe38f7f297b01a0ec4580047d1ed1438aab49cb2';
inputs.expectedSupplementalCollectionSha256 = 'f611762898cee59b00888ca5bda484f5c901b2fa95652ca35fe75b403de88ddf';
const saved = JSON.parse(await readFile(new URL('supplement-001/BRIDGE.json', dir), 'utf8'));
const sourceRoot = process.env.H19_M11_SOURCE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const evaluation = new Set(inputs.closure.components.filter((c) => c.split === 'evaluation').flatMap((c) => Object.keys(c.sourceBindings)));
const readers = {
  readSource: async (p) => { assert(!evaluation.has(p), 'evaluation source must never be read'); return readFile(path.join(sourceRoot, p)); },
  readProducer: async (p) => readFile(new URL(p, kit)),
};
assert.deepEqual(await materializeM11Supplement({ ...inputs, ...readers }), saved);
assert.deepEqual(saved.materialization.counts, { anchors: 22, materializedAnchors: 9, skippedAnchors: 13,
  uniquePackets: 5, uniqueBatches: 5, uniqueCases: 3 });
assert.equal(saved.materialization.rows.filter((r) => r.reason === 'missing-observations').length, 0);
assert.equal(saved.observations.receipts.length, 22);
assert.equal(saved.newEmpiricalRuns, 0);
for (const r of inputs.previousBridge.observations.receipts) {
  assert.deepEqual(saved.observations.receipts.find((x) => x.anchorId === r.anchorId), r, 'original receipt changed');
  assert.deepEqual(saved.materialization.rows.find((x) => x.anchorId === r.anchorId),
    inputs.previousBridge.materialization.rows.find((x) => x.anchorId === r.anchorId), 'original row changed');
}
for (const c of inputs.previousBridge.materialization.relationalCases) {
  assert.deepEqual(saved.materialization.relationalCases.find((x) => x.caseSha256 === c.caseSha256), c);
}
const runtime = inputs.supplementalCollection.runs[2], suite = inputs.plan.suites[2];
assert.equal(runtime.controls.topLevelControls, 4); assert.equal(runtime.controls.nestedChecks, 5);
assert.equal(runtime.controls.summary.tests, 9);
assert.deepEqual(summarizeM11SupplementTap(runtime.stdout.replaceAll('\n', '\r\n'), suite, 0), runtime.controls);
for (const [stdout, code, transport] of [
  [runtime.stdout.replace('ok 1 - S07', 'not ok 1 - S07'), 0, null],
  [runtime.stdout.replace('ok 1 - claim timeout prevents provider calls', 'ok 1 - unrelated'), 0, null],
  [runtime.stdout.replace('# tests 9', '# tests 4'), 0, null],
  [runtime.stdout.replace('ok 1 - S07', 'ok 1 - WRONG'), 0, null],
  [runtime.stdout.replace('ok 1 - claim timeout prevents provider calls', 'ok 1 - claim timeout prevents provider calls # SKIP'), 0, null],
  [runtime.stdout, 1, null], [runtime.stdout, null, { code: 'ETIMEDOUT' }], ['', 0, null],
]) assert.equal(summarizeM11SupplementTap(stdout, suite, code, transport).state, 'ineligible');

const seal = (value, key) => { const { [key]: ignored, ...body } = value; return { ...body, [key]: m11Digest(body) }; };
function changedRun(edit) {
  const x = structuredClone(inputs); edit(x.supplementalCollection.runs[2]);
  x.supplementalCollection.runs = x.supplementalCollection.runs.map((r) => seal(r, 'observationSha256'));
  x.supplementalCollection = seal(x.supplementalCollection, 'collectionSha256');
  x.expectedSupplementalCollectionSha256 = x.supplementalCollection.collectionSha256;
  return x;
}
for (const [edit, error] of [
  [(r) => { r.targets[0].coverage.calledNamedFunctions = 999; }, /V8 summary/],
  [(r) => { r.controls.topLevelControls = 9; }, /TAP control/],
  [(r) => { r.command[3] = 'tests/f13-calendar-refresh.test.mjs'; }, /run set/],
  [(r) => { r.sourceBindings['src/calendar-refresh.ts'] = 'a'.repeat(40); }, /run ancestry/],
  [(r) => { r.loadedSourcePaths.push('src/calendar-refresh.ts'); r.loadedSourcePaths.sort(); }, /development boundary/],
  [(r) => { r.loadedDependencyPaths.push('node_modules/other/index.js'); r.loadedDependencyPaths.sort(); }, /unbound runtime/],
  [(r) => { r.runtimeDependency.version = '0.0.0'; }, /environment/],
  [(r) => { r.targets[0].gitBlobSha = 'a'.repeat(40); }, /target source/],
  [(r) => { r.startedAt = '2020-01-01T00:00:00.000Z'; }, /run times/],
]) assert.throws(() => deriveM11SupplementReceipts(changedRun(edit)), error);
const failed = changedRun((r) => {
  r.exitCode = 1; r.controls = summarizeM11SupplementTap(r.stdout, suite, r.exitCode);
});
const incomplete = deriveM11SupplementReceipts(failed);
assert.equal(incomplete.receipts.length, 6);
assert.equal(incomplete.decisions.filter((d) => d.status === 'ineligible-observation').length, 4);
await assert.rejects(materializeM11Supplement({ ...inputs, ...readers,
  readSource: async (p) => `${await readers.readSource(p)} changed` }), /source identity/);
await assert.rejects(materializeM11Supplement({ ...inputs, ...readers,
  readProducer: async (p) => `${await readers.readProducer(p)} changed` }), /producer identity/);
await assert.rejects(materializeM11Supplement({ ...inputs, ...readers,
  expectedPlanSha256: '0'.repeat(64) }), /planSha256 identity/);

const supplemental = deriveM11SupplementReceipts(inputs);
for (const r of supplemental.receipts) for (const f of r.factPool) {
  if (f.fact.family === 'dependency') assert.deepEqual(f.fact.lineageIds, [inputs.staticAudit.auditSha256]);
  else assert(inputs.supplementalCollection.runs.some((run) => f.fact.lineageIds[0] === run.observationSha256));
  assert(!f.fact.lineageIds.includes(inputs.closure.closureSha256), 'global closure cannot become a fact root');
}
assert.equal(supplemental.receipts.filter((r) => r.anchorId >= 'M11-PILOT-019' && r.anchorId <= 'M11-PILOT-022').length, 4);
const skips = saved.materialization.rows.flatMap((r) => r.hypothesisSkips);
assert.equal(skips.length, 4); assert(skips.every((s) => s.reason === 'insufficient-eligible-facts'));
assert.equal(new Set(skips.map((s) => s.hypothesisId)).size, 1, 'one skipped hypothesis bound to four controls');
console.log('M11 supplement: exact-source offline replay, 10+5 controls, unknowns, source/dependency/producer bindings, evaluation exclusion, failure retention and old receipt preservation PASS');
