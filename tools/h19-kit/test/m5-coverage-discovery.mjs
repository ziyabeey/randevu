import assert from 'node:assert/strict';

import { discoverCoverageHypotheses } from '../src/discovery/coverage-discovery.mjs';

const impact = {
  symbolImpact: {
    report: {
      uncoveredPaths: ['worker/bookings.ts'],
      unknownCoveragePaths: ['worker/calendar.ts'],
      historicalCompanionsMissing: [{
        changed: 'worker/bookings.ts',
        missing: 'tests/bookings-http.mjs',
        confidence: 0.91,
      }],
    },
  },
};

const packet = discoverCoverageHypotheses({
  impact,
  survivingMutants: [{
    id: 'mut-17',
    path: 'worker/bookings.ts',
    unitId: 'worker/bookings.ts::createBooking@40',
    mutatorId: 'boundary.flip',
  }],
  existingTests: ['tests/bookings-http.mjs'],
});

assert.equal(packet.hypotheses.length, 4);
assert.equal(packet.highPriorityCount, 2);
assert.equal(packet.hypotheses[0].reason, 'surviving-mutant');
assert.ok(packet.hypotheses.some((x) => x.reason === 'explicit-runtime-coverage-gap'));
assert.ok(packet.hypotheses.some((x) => x.reason === 'unknown-runtime-coverage-on-impacted-reference'));
assert.ok(packet.hypotheses.some((x) => x.reason === 'historical-companion-not-changed'));
assert.ok(packet.missingTestTargets.includes('worker/bookings.ts'));
assert.ok(packet.missingTestTargets.includes('worker/calendar.ts'));
assert.ok(!packet.missingTestTargets.includes('tests/bookings-http.mjs'));
assert.equal(packet.evidence[0].state, 'present');
assert.equal(packet.evidence[1].state, 'present');

const empty = discoverCoverageHypotheses({
  impact: {
    symbolImpact: {
      report: {
        uncoveredPaths: [],
        unknownCoveragePaths: [],
        historicalCompanionsMissing: [],
      },
    },
  },
});
assert.equal(empty.hypotheses.length, 0);
assert.equal(empty.evidence[0].state, 'absent');
assert.equal(empty.evidence[1].state, 'absent');

console.log('h19-kit M5 coverage-discovery smoke: ok');
