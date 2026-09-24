import assert from 'node:assert/strict';

import {
  createMinimalTestSpec,
  validateMinimalTestSpec,
} from '../src/specification/minimal-test-spec.mjs';

const packet = {
  packetSha256: 'a'.repeat(64),
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
      mutationId: 'mut-17',
      mutatorId: 'boundary.flip',
      requiresRuntimeEvidence: true,
    },
  }, {
    id: 'coverage:unknown-runtime:worker_calendar.ts',
    target: { kind: 'path', path: 'worker/calendar.ts' },
    reason: 'unknown-runtime-coverage-on-impacted-reference',
    priority: 'medium',
    evidenceIds: ['impact.coverage_gap.present'],
    validation: {
      preferred: 'targeted-test-or-mutation',
      requiresRuntimeEvidence: true,
    },
  }],
};

const incomplete = createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
});

assert.equal(incomplete.packetSha256, packet.packetSha256);
assert.equal(incomplete.hypothesisId, packet.hypotheses[0].id);
assert.equal(incomplete.mutation.mutationId, 'mut-17');
assert.equal(incomplete.mutation.mutatorId, 'boundary.flip');
assert.equal(incomplete.setup.state, 'unknown');
assert.equal(incomplete.action.state, 'unknown');
assert.equal(incomplete.expectedInvariant.state, 'unknown');
assert.equal(incomplete.requiredObservations.state, 'unknown');
assert.equal(incomplete.readiness.readyForExecutableGeneration, false);
assert.deepEqual(incomplete.readiness.missingSections, [
  'setup',
  'action',
  'expectedInvariant',
  'requiredObservations',
]);
validateMinimalTestSpec(incomplete);

const hints = {
  setup: ['Create a slot with capacity 1.'],
  action: ['Submit the competing booking operation.'],
  expectedInvariant: ['Committed capacity never drops below zero.'],
  requiredObservations: ['booking result', 'persisted capacity', 'version/conflict outcome'],
};

const validation = {
  packetSha256: packet.packetSha256,
  hypothesisId: packet.hypotheses[0].id,
  status: 'confirmed',
  observed: { mutantKilled: true },
};

const readyA = createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  validation,
  hints,
});

const readyB = createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  validation,
  hints,
});

assert.equal(readyA.readiness.readyForExecutableGeneration, true);
assert.equal(readyA.specSha256, readyB.specSha256);
assert.equal(readyA.validationStatus, 'confirmed');
validateMinimalTestSpec(readyA);

assert.throws(() => createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[1].id,
}), /not eligible/);

const confirmedMedium = createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[1].id,
  validation: {
    packetSha256: packet.packetSha256,
    hypothesisId: packet.hypotheses[1].id,
    status: 'confirmed',
  },
});
assert.equal(confirmedMedium.readiness.eligible, true);
assert.equal(confirmedMedium.readiness.readyForExecutableGeneration, false);

assert.throws(() => createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  validation: {
    packetSha256: 'b'.repeat(64),
    hypothesisId: packet.hypotheses[0].id,
    status: 'confirmed',
  },
}), /packet mismatch/);

assert.throws(() => createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  validation: {
    packetSha256: packet.packetSha256,
    hypothesisId: 'wrong',
    status: 'confirmed',
  },
}), /hypothesis mismatch/);

assert.throws(() => createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  validation: {
    packetSha256: packet.packetSha256,
    hypothesisId: packet.hypotheses[0].id,
    status: 'rejected',
  },
}), /rejected hypothesis/);

const malformedPacket = {
  packetSha256: 'c'.repeat(64),
  hypotheses: [{
    ...packet.hypotheses[0],
    validation: {
      preferred: 'test-that-kills-mutant',
      mutationId: null,
      mutatorId: 'boundary.flip',
    },
  }],
};
assert.throws(() => createMinimalTestSpec({
  packet,
  hypothesisId: packet.hypotheses[0].id,
  schemaVersion: 2,
}), /unsupported minimal test spec schemaVersion/);

assert.throws(() => createMinimalTestSpec({
  packet: malformedPacket,
  hypothesisId: malformedPacket.hypotheses[0].id,
}), /requires mutationId and mutatorId/);

console.log('h19-kit M6 minimal test specification smoke: ok');
