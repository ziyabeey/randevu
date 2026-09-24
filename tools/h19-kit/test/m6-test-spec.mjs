import assert from 'node:assert/strict';

import {
  coverageValidationResult,
  freezeCoverageDiscoveryPacket,
} from '../src/discovery/validation-packet.mjs';
import {
  buildTestSpecification,
  freezeTestRecipe,
  recipeDigest,
  validateTestSpecification,
} from '../src/specification/test-spec.mjs';

const mutantHypothesis = {
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
};

const packet = freezeCoverageDiscoveryPacket({
  changeId: 'pr-123',
  sourceRevision: 'abc123',
  impact: {
    changedFiles: ['worker/bookings.ts'],
    unknowns: [],
    safeToNarrow: true,
  },
  discovery: { hypotheses: [mutantHypothesis] },
});

const packetBefore = JSON.stringify(packet);

// TS2/TS3/TS4/TS5/TS7: deterministic partial spec, no fabrication, mutation preserved, input immutable.
const partialA = buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
});
const partialB = buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
});
assert.equal(partialA.specSha256, partialB.specSha256);
assert.equal(partialA.readyForExecution, false);
assert.deepEqual(partialA.unknowns, [
  'setup',
  'action',
  'expectedInvariant',
  'requiredObservations',
]);
assert.equal(partialA.setup.state, 'unknown');
assert.equal(partialA.action.value, null);
assert.equal(partialA.expectedInvariant.value, null);
assert.equal(partialA.requiredObservations.items.length, 0);
assert.equal(partialA.mutationToKill.state, 'known');
assert.equal(partialA.mutationToKill.mutationId, 'mut-17');
assert.equal(partialA.mutationToKill.mutatorId, 'boundary.flip');
assert.equal(JSON.stringify(packet), packetBefore);
assert.equal(validateTestSpecification(partialA), partialA);

// Complete deterministic recipe makes the surviving-mutant spec executable-ready.
const recipe = freezeTestRecipe({
  recipeId: 'booking.capacity-boundary',
  version: '1',
  matches: {
    reason: 'surviving-mutant',
    mutatorId: 'boundary.flip',
  },
  setup: ['Create a booking fixture at the target boundary.'],
  action: 'Execute the booking operation at that boundary.',
  expectedInvariant: 'The boundary invariant remains satisfied.',
  observations: ['Return result', 'Persisted booking state'],
});
assert.equal(recipeDigest(recipe), recipe.digest);

const complete = buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
  recipe,
});
assert.equal(complete.readyForExecution, true);
assert.deepEqual(complete.unknowns, []);
assert.equal(complete.origin.recipe.digest, recipe.digest);
assert.ok(complete.setup.provenance[0].startsWith('recipe:'));
assert.equal(validateTestSpecification(complete), complete);

// TS1: recipe identity/content participates in spec identity.
const recipeV2 = freezeTestRecipe({
  ...recipe,
  version: '2',
  digest: undefined,
});
const completeV2 = buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
  recipe: recipeV2,
});
assert.notEqual(complete.specSha256, completeV2.specSha256);

// TS1: packet/source revision participates in identity.
const packet2 = freezeCoverageDiscoveryPacket({
  changeId: 'pr-123',
  sourceRevision: 'def456',
  impact: {
    changedFiles: ['worker/bookings.ts'],
    unknowns: [],
    safeToNarrow: true,
  },
  discovery: { hypotheses: [mutantHypothesis] },
});
const completeOnRevision2 = buildTestSpecification({
  packet: packet2,
  hypothesisId: mutantHypothesis.id,
  recipe,
});
assert.notEqual(complete.specSha256, completeOnRevision2.specSha256);

// Fail closed on packet or recipe tampering.
assert.throws(() => buildTestSpecification({
  packet: { ...packet, packetSha256: '0'.repeat(64) },
  hypothesisId: mutantHypothesis.id,
}), /packet hash mismatch/);

assert.throws(() => buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
  recipe: { ...recipe, digest: '0'.repeat(64) },
}), /recipe digest mismatch/);

assert.throws(() => buildTestSpecification({
  packet,
  hypothesisId: mutantHypothesis.id,
  recipe: freezeTestRecipe({
    recipeId: 'wrong',
    version: '1',
    matches: { reason: 'surviving-mutant', mutatorId: 'other' },
    setup: ['x'],
    action: 'x',
    expectedInvariant: 'x',
    observations: ['x'],
  }),
}), /mutator does not match/);

// TS6: non-mutant hypothesis needs confirmed validation.
const coverageHypothesis = {
  id: 'coverage:explicit-runtime-coverage-gap:worker_calendar.ts',
  target: { kind: 'path', path: 'worker/calendar.ts' },
  reason: 'explicit-runtime-coverage-gap',
  priority: 'high',
  evidenceIds: ['impact.coverage_gap.present'],
  validation: {
    preferred: 'targeted-test-or-mutation',
    requiresRuntimeEvidence: true,
  },
};

const packetCoverage = freezeCoverageDiscoveryPacket({
  changeId: 'pr-124',
  sourceRevision: 'abc124',
  impact: {
    changedFiles: ['worker/calendar.ts'],
    unknowns: [],
    safeToNarrow: true,
  },
  discovery: { hypotheses: [coverageHypothesis] },
});

assert.throws(() => buildTestSpecification({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
}), /requires confirmed validation/);

const confirmed = coverageValidationResult({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  status: 'confirmed',
  observed: { coverageGapReproduced: true },
});
const coverageRecipe = freezeTestRecipe({
  recipeId: 'calendar.coverage-gap',
  version: '1',
  matches: { reason: 'explicit-runtime-coverage-gap' },
  setup: ['Prepare the calendar fixture.'],
  action: 'Run the impacted calendar operation.',
  expectedInvariant: 'The calendar contract remains satisfied.',
  observations: ['Return result'],
});
const confirmedSpec = buildTestSpecification({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  validationResult: confirmed,
  recipe: coverageRecipe,
});
assert.equal(confirmedSpec.readyForExecution, true);
assert.equal(confirmedSpec.mutationToKill.state, 'unknown');
assert.equal(confirmedSpec.origin.validation.status, 'confirmed');
assert.match(confirmedSpec.origin.validation.digest, /^[a-f0-9]{64}$/);

const rejected = coverageValidationResult({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  status: 'rejected',
  observed: {},
});
assert.throws(() => buildTestSpecification({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  validationResult: rejected,
}), /rejected hypothesis/);

const inconclusive = coverageValidationResult({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  status: 'inconclusive',
  observed: {},
});
assert.throws(() => buildTestSpecification({
  packet: packetCoverage,
  hypothesisId: coverageHypothesis.id,
  validationResult: inconclusive,
}), /inconclusive hypothesis/);

// Builder never mutates source inputs and emits data only.
assert.equal(JSON.stringify(packet), packetBefore);
assert.equal(Object.isFrozen(complete), true);

console.log('h19-kit M6 minimal test specification smoke: ok');
