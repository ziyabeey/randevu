import assert from 'node:assert/strict';

import {
  coverageValidationResult,
  freezeCoverageDiscoveryPacket,
} from '../src/discovery/validation-packet.mjs';

const impact = {
  changedFiles: ['worker/bookings.ts'],
  unknowns: [],
  safeToNarrow: true,
};

const discovery = {
  hypotheses: [{
    id: 'coverage:surviving-mutant:mut-17:worker_bookings.ts',
    target: {
      kind: 'semantic-unit',
      path: 'worker/bookings.ts',
      unitId: 'worker/bookings.ts::createBooking@40',
    },
    reason: 'surviving-mutant',
    priority: 'high',
    evidenceIds: ['mutation.survivor.present'],
    validation: {
      preferred: 'test-that-kills-mutant',
      mutatorId: 'boundary.flip',
      mutationId: 'mut-17',
      requiresRuntimeEvidence: true,
    },
  }],
};

const a = freezeCoverageDiscoveryPacket({
  changeId: 'pr-123',
  sourceRevision: 'abc123',
  impact,
  discovery,
});

const b = freezeCoverageDiscoveryPacket({
  changeId: 'pr-123',
  sourceRevision: 'abc123',
  impact,
  discovery,
});

assert.equal(a.packetSha256, b.packetSha256);
assert.equal(a.schemaVersion, 1);
assert.equal(a.hypotheses.length, 1);

const result = coverageValidationResult({
  packet: a,
  hypothesisId: a.hypotheses[0].id,
  status: 'confirmed',
  observed: {
    test: 'tests/bookings-boundary.mjs',
    mutantKilled: true,
  },
});

assert.equal(result.packetSha256, a.packetSha256);
assert.equal(result.status, 'confirmed');
assert.equal(result.observed.mutantKilled, true);

assert.throws(() => coverageValidationResult({
  packet: a,
  hypothesisId: 'missing',
  status: 'confirmed',
}), /unknown hypothesis/);

console.log('h19-kit M5 coverage validation packet smoke: ok');
