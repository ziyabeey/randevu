import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  RELATION_DIRECTION_QUESTION,
  validateRelationalEvidenceCase,
} from '../src/relations/relational-evidence.mjs';

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));

const [freeze, bridge] = await Promise.all([
  load('independent-assessment-001/FREEZE.json'),
  load('supplement-001/BRIDGE.json'),
]);

assert.equal(freeze.schemaVersion, 1);
assert.equal(freeze.kind, 'm11-independent-relation-assessment-freeze');
assert.equal(freeze.version, '0.1');
assert.equal(freeze.status, 'frozen-inputs-labels-pending');
assert.equal(freeze.labelsCollected, 0);
assert.equal(freeze.sourceRevision, '07688ae08ef5c834bcadf5dc6a23c4e42e4621dd');
assert.equal(freeze.bridgeSha256, bridge.bridgeSha256);
assert.deepEqual(freeze.question, RELATION_DIRECTION_QUESTION);

assert.equal(freeze.assessorContract.requiredIndependentAssessmentsPerCase, 2);
assert.deepEqual(freeze.assessorContract.labels, [
  'strengthens',
  'weakens',
  'unrelated',
  'insufficient',
]);
assert.equal(freeze.assessorContract.assessOnePacketAtATime, true);
assert.deepEqual(freeze.receiptContract.exposure, {
  jevOutputSeen: false,
  laterFunctionalOutcomeSeen: false,
  peerAssessmentSeen: false,
  evaluationObservationSeen: false,
});

const sourceCases = bridge.materialization.relationalCases;
assert.equal(sourceCases.length, 3);
assert.equal(freeze.packets.length, sourceCases.length);

const bySha = new Map(sourceCases.map((relationalCase) => {
  validateRelationalEvidenceCase(relationalCase);
  return [relationalCase.caseSha256, relationalCase];
}));
assert.equal(bySha.size, 3);

for (const [index, packet] of freeze.packets.entries()) {
  assert.equal(packet.packetId, `M11-BLIND-${String(index + 1).padStart(3, '0')}`);
  validateRelationalEvidenceCase(packet.relationalCase);
  assert.deepEqual(
    packet.relationalCase,
    bySha.get(packet.relationalCase.caseSha256),
    `blind packet drift: ${packet.packetId}`,
  );
}

const forbiddenKeys = new Set([
  'judgment',
  'judgments',
  'probabilities',
  'validation',
  'outcome',
  'outcomes',
  'functionalOutcome',
  'providerResponse',
  'jevOutput',
]);

function walk(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKeys.has(key), `forbidden blind-assessment field at ${path}.${key}`);
    walk(child, `${path}.${key}`);
  }
}
freeze.packets.forEach((packet) => walk(packet));

const encoded = JSON.stringify(freeze.packets);
for (const forbiddenText of [
  'notification-validation-001/RESULT.json',
  'targeted-validation-001',
  'm11-notification-behavioral-validation-result',
  'm5-validation',
]) {
  assert(!encoded.includes(forbiddenText), `forbidden later-evidence text leaked: ${forbiddenText}`);
}

console.log('M11 independent-assessment freeze: three exact blind cases, rubric identity and outcome/Jev leakage rejection PASS');
