import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { freezeProtocol } from '../src/experiments/protocol.mjs';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { blindSample } from '../src/experiments/blind-sample.mjs';
import { createBlindPacket, createBlindKey } from '../src/experiments/blind-packet.mjs';
import { auc, leakageGate } from '../src/experiments/auc.mjs';
import { evaluateGates } from '../src/experiments/gates.mjs';
import {
  createLedger, upsertExperiment, transitionExperiment, validateLedger, canTransition,
} from '../src/experiments/ledger.mjs';
import { MutationHistory } from '../src/mutations/history.mjs';

const protocol = freezeProtocol({
  experiment_id: 'DEMO',
  version: '0.1',
  hypothesis: 'The frozen candidate beats the frozen baseline.',
  gates: [
    { id: 'recall', metric: 'recall', op: '>=', threshold: 0.9 },
    { id: 'fpr', metric: 'fpr', op: '<=', threshold: 0.3 },
  ],
});
assert.match(protocol.protocol_sha256, /^[a-f0-9]{64}$/);

const cases = [
  { case_id: 'A01', label: true, naive: 0, rationale: 'secret-a' },
  { case_id: 'A02', label: false, naive: 1, rationale: 'secret-b' },
  { case_id: 'A03', label: true, naive: 0, rationale: 'secret-c' },
  { case_id: 'A04', label: false, naive: 1, rationale: 'secret-d' },
];
const frozen = freezeCases(cases, { experimentId: 'DEMO', protocolVersion: '0.1' });
assert.match(frozen.cases_sha256, /^[a-f0-9]{64}$/);
assert.equal(frozen.cases.length, 4);

const sampleA = blindSample(frozen.cases, { seed: frozen.cases_sha256, count: 2 });
const sampleB = blindSample(frozen.cases, { seed: frozen.cases_sha256, count: 2 });
assert.deepEqual(sampleA.map((x) => x.case_id), sampleB.map((x) => x.case_id));

const packet = createBlindPacket(sampleA, { packetId: 'demo' });
const key = createBlindKey(sampleA, { packetId: 'demo' });
assert.equal(JSON.stringify(packet.cases).includes('rationale'), false);
assert.equal(packet.hidden_keys.includes('rationale'), true);
assert.equal(key.answers.length, 2);
assert.match(packet.packet_sha256, /^[a-f0-9]{64}$/);

assert.equal(auc([true, true, false, false], [0.9, 0.8, 0.2, 0.1]), 1);
const leak = leakageGate({
  cases: frozen.cases,
  label: (x) => x.label,
  features: [{ id: 'naive', score: (x) => x.naive }],
});
assert.equal(leak.pass, false);

const gateResult = evaluateGates({ recall: 0.95, fpr: 0.2 }, protocol.gates);
assert.equal(gateResult.pass, true);

let ledger = createLedger();
ledger = upsertExperiment(ledger, {
  id: 'DEMO',
  status: 'planned',
  protocol_sha256: protocol.protocol_sha256,
});
assert.equal(canTransition('planned', 'preregistered'), true);
assert.equal(canTransition('planned', 'passed'), false);
ledger = transitionExperiment(ledger, 'DEMO', { status: 'preregistered' });
ledger = transitionExperiment(ledger, 'DEMO', {
  status: 'measurement-ready',
  patch: { cases_sha256: frozen.cases_sha256 },
});
assert.throws(
  () => transitionExperiment(ledger, 'DEMO', { status: 'planned' }),
  /invalid experiment transition/,
);
assert.throws(
  () => upsertExperiment(ledger, { id: 'DEMO', status: 'running' }),
  /must use transitionExperiment/,
);
ledger = transitionExperiment(ledger, 'DEMO', { status: 'running' });
ledger = transitionExperiment(ledger, 'DEMO', { status: 'passed' });
assert.equal(validateLedger(ledger).experiments[0].status, 'passed');

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-kit-m3-'));
try {
  const history = await new MutationHistory(path.join(temp, 'mutations.json')).load();
  const spec = {
    sourceDigest: 'a'.repeat(64),
    mutatorId: 'remove-lock',
    mutatorVersion: '0.1.0',
    contextDigest: 'b'.repeat(64),
  };
  assert.equal(history.has(spec), false);
  history.record(spec, { status: 'survived', test: 'concurrency.spec.ts' });
  await history.save();

  const reloaded = await new MutationHistory(path.join(temp, 'mutations.json')).load();
  assert.equal(reloaded.has(spec), true);
  assert.equal(reloaded.get(spec).result.status, 'survived');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M3 smoke: ok');
