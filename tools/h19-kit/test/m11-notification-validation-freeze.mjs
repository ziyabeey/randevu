import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { m11SourceBlobSha } from '../src/experiments/m11-materializer.mjs';
import { validateM11NotificationInputs } from '../src/experiments/m11-notification-validation.mjs';

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));

const [plan, bridge, supplementalCollection, closure, snapshot, inventory] = await Promise.all([
  'notification-validation-001/PLAN.json',
  'supplement-001/BRIDGE.json',
  'supplement-001/COLLECTION.json',
  'REPOSITORY-CLOSURE-001.json',
  'SOURCE-SNAPSHOT-001.json',
  'COHORT-v0.2.json',
].map(load));

const inputs = {
  plan,
  expectedPlanSha256: '77ae3c50eeffe8220cd8736727e7e3efc34a1f6fa2fb3e6be7928959e31aa064',
  bridge,
  supplementalCollection,
  closure,
  snapshot,
  inventory,
};

const valid = validateM11NotificationInputs(inputs);
assert.equal(valid.plan.caseSha256, '2b924bfe4d9dc5e15d40199189b6b8070bee47d2cca3dc68eb24357f660e33f2');
assert.equal(valid.plan.hypothesisId, 'coverage:explicit-runtime-coverage-gap:worker_notifications.ts');
assert.deepEqual(valid.plan.requiredEntries.map((item) => item.name), [
  'validGroupSummary',
  'renderTemplateV2',
]);
assert.equal(valid.lineage.evaluationOverlap.length, 0);
assert.deepEqual(valid.lineage.executionPaths, [
  'shared/base64.ts',
  'worker/notifications.ts',
  'worker/outbound-request.ts',
]);

const candidate = await readFile(new URL(valid.plan.candidate.path, dir));
assert.equal(m11SourceBlobSha(candidate), valid.plan.candidate.gitBlobSha);

for (const [path, sha] of Object.entries(valid.plan.producerBindings)) {
  const bytes = await readFile(new URL('../' + path, import.meta.url));
  assert.equal(m11SourceBlobSha(bytes), sha, `producer drift: ${path}`);
}

const tampered = structuredClone(plan);
tampered.caseSha256 = '0'.repeat(64);
const { planSha256: _old, ...body } = tampered;
const invalid = { ...body, planSha256: plan.planSha256 };
assert.throws(() => validateM11NotificationInputs({ ...inputs, plan: invalid }), /planSha256 identity/);

console.log('M11 notification validation freeze: plan, case, gap entries, source closure, candidate and producer bindings PASS');
