import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  freezeM11IndependentAssessmentReceipt,
  summarizeM11IndependentAssessmentReceipts,
  validateM11IndependentAssessmentFreeze,
  validateM11IndependentAssessmentReceipt,
} from '../src/experiments/m11-independent-assessment.mjs';

const dir = new URL('../experiments/m11/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));

const [freeze, bridge] = await Promise.all([
  load('independent-assessment-001/FREEZE.json'),
  load('supplement-001/BRIDGE.json'),
]);

validateM11IndependentAssessmentFreeze(freeze, { bridge });

const exposure = {
  jevOutputSeen: false,
  laterFunctionalOutcomeSeen: false,
  peerAssessmentSeen: false,
  evaluationObservationSeen: false,
};

const a = freezeM11IndependentAssessmentReceipt({
  freeze,
  packetId: 'M11-BLIND-001',
  assessorId: 'synthetic-assessor-a',
  assessorKind: 'synthetic-test-fixture',
  label: 'insufficient',
  rationale: 'Synthetic fixture only: the receipt contract is being exercised without creating empirical reference evidence.',
  exposure,
  sealedAt: '2026-09-25T16:00:00.000Z',
});
const aReplay = freezeM11IndependentAssessmentReceipt({
  freeze,
  packetId: 'M11-BLIND-001',
  assessorId: 'synthetic-assessor-a',
  assessorKind: 'synthetic-test-fixture',
  label: 'insufficient',
  rationale: 'Synthetic fixture only: the receipt contract is being exercised without creating empirical reference evidence.',
  exposure,
  sealedAt: '2026-09-25T16:00:00.000Z',
});
assert.deepEqual(a, aReplay);
validateM11IndependentAssessmentReceipt(a, { freeze });
assert.match(a.receiptSha256, /^[a-f0-9]{64}$/);
assert.match(a.inputSha256, /^[a-f0-9]{64}$/);
assert.equal(a.caseSha256, freeze.packets[0].relationalCase.caseSha256);

const b = freezeM11IndependentAssessmentReceipt({
  freeze,
  packetId: 'M11-BLIND-001',
  assessorId: 'synthetic-assessor-b',
  assessorKind: 'synthetic-test-fixture',
  label: 'unrelated',
  rationale: 'Synthetic second receipt exercises distinct-assessor bookkeeping only; it is not a reference label.',
  exposure,
  sealedAt: '2026-09-25T16:00:01.000Z',
});

const ledger = summarizeM11IndependentAssessmentReceipts([a, b], { freeze });
assert.equal(ledger.receiptCount, 2);
assert.equal(ledger.twoDistinctReceiptPackets, 1);
assert.equal(ledger.independenceVerifiedPackets, 0);
assert.equal(ledger.resolvedReferenceLabels, 0);
assert.equal(ledger.packets[0].twoDistinctReceiptsPresent, true);
assert.equal(ledger.packets[0].independenceVerified, false);
assert.equal(ledger.packets[0].resolvedReferenceLabel, null);
assert.deepEqual(ledger.packets[0].labels, ['insufficient', 'unrelated']);
assert.equal(
  ledger.note,
  'Structural receipt validation cannot establish assessor independence or resolve reference truth.',
);

const tampered = structuredClone(a);
tampered.label = 'strengthens';
assert.throws(
  () => validateM11IndependentAssessmentReceipt(tampered, { freeze }),
  /receipt digest mismatch/,
);

assert.throws(
  () => freezeM11IndependentAssessmentReceipt({
    freeze,
    packetId: 'M11-BLIND-001',
    assessorId: 'synthetic-assessor-c',
    assessorKind: 'synthetic-test-fixture',
    label: 'insufficient',
    rationale: 'Exposure must fail closed.',
    exposure: { ...exposure, jevOutputSeen: true },
    sealedAt: '2026-09-25T16:00:02.000Z',
  }),
  /exposure must remain false: jevOutputSeen/,
);

assert.throws(
  () => freezeM11IndependentAssessmentReceipt({
    freeze,
    packetId: 'M11-BLIND-999',
    assessorId: 'synthetic-assessor-c',
    assessorKind: 'synthetic-test-fixture',
    label: 'insufficient',
    rationale: 'Unknown packet must fail.',
    exposure,
    sealedAt: '2026-09-25T16:00:02.000Z',
  }),
  /unknown independent-assessment packet/,
);

const duplicateAssessor = freezeM11IndependentAssessmentReceipt({
  freeze,
  packetId: 'M11-BLIND-001',
  assessorId: 'synthetic-assessor-a',
  assessorKind: 'synthetic-test-fixture',
  label: 'weakens',
  rationale: 'A second vote from the same assessor must not count as another receipt.',
  exposure,
  sealedAt: '2026-09-25T16:00:03.000Z',
});
assert.throws(
  () => summarizeM11IndependentAssessmentReceipts([a, duplicateAssessor], { freeze }),
  /same assessor cannot submit two receipts for one packet/,
);

const driftedFreeze = structuredClone(freeze);
driftedFreeze.sourceRevision = '0'.repeat(40);
assert.throws(
  () => validateM11IndependentAssessmentFreeze(driftedFreeze, { bridge }),
  /blind packet source revision mismatch/,
);

const driftedBridge = structuredClone(bridge);
driftedBridge.materialization.relationalCases[0].authority = 'changed';
assert.throws(
  () => validateM11IndependentAssessmentFreeze(freeze, { bridge: driftedBridge }),
  /blind packet differs from bridge case/,
);

console.log('M11 independent-assessment receipts: deterministic sealing, exact input binding, exposure fail-closed, duplicate-assessor rejection and no automatic truth resolution PASS');
