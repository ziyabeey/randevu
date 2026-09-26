import assert from 'node:assert/strict';

import {
  compareH19BlindSpotLedgers,
  detectH19BlindSpots,
  validateH19BlindSpotLedger,
} from '../src/diagnostics/blind-spots.mjs';

const revision = 'a'.repeat(40);
const inventory = {
  version: 1,
  filesScanned: 2,
  units: [{
    id: 'component.ts::render@1',
    language: 'typescript',
    kind: 'FunctionDeclaration',
    path: 'component.ts',
    symbol: 'render',
    startLine: 1,
    endLine: 3,
  }],
  errors: [],
};

function impact(unknownCoveragePaths, { exposeReport = true } = {}) {
  const symbolImpact = {
    mapping: {
      matches: [{
        unitId: 'component.ts::render@1',
        path: 'component.ts',
        symbol: 'demo/render#',
        mode: 'definition-near-start',
        candidates: [],
      }],
      unmatched: [],
    },
  };
  if (exposeReport) {
    symbolImpact.report = {
      unknownCoveragePaths: [...unknownCoveragePaths],
    };
  }

  return {
    changedFiles: ['component.ts'],
    unknowns: unknownCoveragePaths.length ? ['runtime-coverage'] : [],
    safeToNarrow: unknownCoveragePaths.length === 0,
    symbolImpact,
  };
}

function ledger(paths, options = {}) {
  return detectH19BlindSpots({
    inventory,
    focusFiles: ['component.ts'],
    impacts: [{
      scopeId: 'typescript:component.ts',
      impact: impact(paths, options),
    }],
    sourceRevision: revision,
  });
}

const before = ledger(['component.ts', 'tests/component.spec.ts']);
validateH19BlindSpotLedger(before);
assert.equal(before.counts.total, 2);
assert.equal(before.counts.byCategory['runtime-coverage-unknown-path'], 2);
assert.equal(before.counts.byCategory['impact-unknown'], 0);
assert.deepEqual(
  before.spots.map((spot) => spot.subject.path).sort(),
  ['component.ts', 'tests/component.spec.ts'],
);

const partial = ledger(['tests/component.spec.ts']);
validateH19BlindSpotLedger(partial);
assert.equal(partial.counts.total, 1);
assert.equal(partial.spots[0].category, 'runtime-coverage-unknown-path');
assert.equal(partial.spots[0].subject.path, 'tests/component.spec.ts');

const partialComparison = compareH19BlindSpotLedgers(before, partial);
assert.equal(partialComparison.comparable, true);
assert.equal(partialComparison.counts.before, 2);
assert.equal(partialComparison.counts.after, 1);
assert.equal(partialComparison.counts.resolved, 1);
assert.equal(partialComparison.counts.persistent, 1);
assert.equal(partialComparison.counts.introduced, 0);
assert.equal(partialComparison.blindSpotReductionRate, 0.5);

const complete = ledger([]);
validateH19BlindSpotLedger(complete);
assert.equal(complete.counts.total, 0);

const completeComparison = compareH19BlindSpotLedgers(before, complete);
assert.equal(completeComparison.comparable, true);
assert.equal(completeComparison.counts.resolved, 2);
assert.equal(completeComparison.counts.persistent, 0);
assert.equal(completeComparison.blindSpotReductionRate, 1);

const legacyAggregate = ledger(['component.ts'], { exposeReport: false });
validateH19BlindSpotLedger(legacyAggregate);
assert.equal(legacyAggregate.counts.total, 1);
assert.equal(legacyAggregate.spots[0].category, 'impact-unknown');
assert.equal(legacyAggregate.spots[0].subject.unknown, 'runtime-coverage');

console.log('H19 runtime-coverage blind spots: per-path identities, partial closure, complete closure and aggregate fallback PASS');
