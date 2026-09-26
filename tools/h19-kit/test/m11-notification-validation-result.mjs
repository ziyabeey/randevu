import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { interpretM11NotificationRun } from '../src/experiments/m11-notification-validation.mjs';

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));

const [plan, bridge, supplementalCollection, closure, snapshot, inventory, result] = await Promise.all([
  'notification-validation-001/PLAN.json',
  'supplement-001/BRIDGE.json',
  'supplement-001/COLLECTION.json',
  'REPOSITORY-CLOSURE-001.json',
  'SOURCE-SNAPSHOT-001.json',
  'COHORT-v0.2.json',
  'notification-validation-001/RESULT.json',
].map(load));

const inputs = {
  plan,
  expectedPlanSha256: '9478ae5199235075f1b142fab20de20222aa150a29a68c856239da1008855e3c',
  bridge,
  supplementalCollection,
  closure,
  snapshot,
  inventory,
};

const replayed = interpretM11NotificationRun(inputs, result.run);
assert.deepEqual(result, replayed, 'saved notification result must equal deterministic replay');
assert.equal(result.validation.status, 'confirmed');
assert.equal(result.outcome.kind, 'm5-validation');
assert.equal(result.outcome.value, 'confirmed');
assert.equal(result.counts.behavioralControlsPassed, 6);
assert.equal(result.counts.newCallsToOriginalUncalledEntries, 2);
assert.equal(result.counts.functionalDefectsEstablished, 0);
assert.equal(result.counts.relationAssessments, 0);
assert.equal(result.counts.realProviderCalls, 0);
assert.deepEqual(
  result.validation.observed.gapChecks.map(({ name, observed, called }) => ({ name, observed, called })),
  [
    { name: 'validGroupSummary', observed: true, called: true },
    { name: 'renderTemplateV2', observed: true, called: true },
  ],
);

const tampered = structuredClone(result.run);
tampered.completed = false;
assert.throws(
  () => interpretM11NotificationRun(inputs, tampered),
  /observationSha256 identity mismatch/,
  'replay must reject changed run bytes',
);

console.log('M11 notification saved-result replay: deterministic result identity, confirmed gap closure and tamper rejection PASS');
