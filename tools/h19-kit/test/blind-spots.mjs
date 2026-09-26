import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { repositoryInventory } from '../src/repository/inventory.mjs';
import { buildPythonEvidenceGraph } from '../src/indexing/python-evidence-graph.mjs';
import { analyzeChangeImpact } from '../src/impact/change-impact.mjs';

import {
  compareH19BlindSpotLedgers,
  detectH19BlindSpots,
  validateH19BlindSpotLedger,
} from '../src/diagnostics/blind-spots.mjs';

const revision = 'a'.repeat(40);

function impact({
  matches,
  unknowns,
  safeToNarrow = false,
}) {
  return {
    changedFiles: ['execution/negative_controls.py'],
    unknowns,
    safeToNarrow,
    symbolImpact: {
      mapping: {
        matches,
        unmatched: matches.filter((row) => row.symbol == null).map((row) => row.unitId),
      },
    },
  };
}

const beforeInventory = {
  version: 1,
  filesScanned: 2,
  units: [
    {
      id: 'execution/negative_controls.py::foo@1',
      language: 'python',
      kind: 'FunctionDef',
      path: 'execution/negative_controls.py',
      symbol: 'foo',
      startLine: 1,
      endLine: 2,
    },
    {
      id: 'execution/negative_controls.py::bar@4',
      language: 'python',
      kind: 'FunctionDef',
      path: 'execution/negative_controls.py',
      symbol: 'bar',
      startLine: 4,
      endLine: 5,
    },
  ],
  errors: [],
};

const beforeImpact = impact({
  matches: [
    {
      unitId: 'execution/negative_controls.py::foo@1',
      path: 'execution/negative_controls.py',
      symbol: null,
      mode: 'unmatched',
      candidates: [],
    },
    {
      unitId: 'execution/negative_controls.py::bar@4',
      path: 'execution/negative_controls.py',
      symbol: null,
      mode: 'unmatched',
      candidates: [],
    },
  ],
  unknowns: ['semantic-unit-symbol-mapping', 'project-ownership'],
});

const before = detectH19BlindSpots({
  inventory: beforeInventory,
  focusFiles: ['preflight/verify_t1.py'],
  impacts: [{ scopeId: 'negative-controls', impact: beforeImpact }],
  sourceRevision: revision,
});

validateH19BlindSpotLedger(before);
assert.equal(before.counts.total, 5);
assert.deepEqual(before.counts.byCategory, {
  'extraction-error': 0,
  'impact-unknown': 2,
  'runtime-coverage-unknown-path': 0,
  'semantic-unit-absence': 1,
  'semantic-unit-symbol-unmatched': 2,
});
assert.ok(before.spots.every((spot) =>
  spot.state === 'candidate' && spot.authority === 'diagnostic-only'));
assert.ok(before.spots.some((spot) =>
  spot.category === 'semantic-unit-absence'
  && spot.subject.path === 'preflight/verify_t1.py'));

const afterInventory = {
  version: 1,
  filesScanned: 2,
  units: [
    ...beforeInventory.units,
    {
      id: 'preflight/verify_t1.py::<module>@6',
      language: 'python',
      kind: 'Module',
      path: 'preflight/verify_t1.py',
      symbol: '<module>',
      startLine: 6,
      endLine: 47,
    },
  ],
  errors: [],
};

const afterImpact = impact({
  matches: [
    {
      unitId: 'execution/negative_controls.py::foo@1',
      path: 'execution/negative_controls.py',
      symbol: 'python execution.negative_controls::foo',
      mode: 'definition-near-start',
      candidates: [],
    },
    {
      unitId: 'execution/negative_controls.py::bar@4',
      path: 'execution/negative_controls.py',
      symbol: 'python execution.negative_controls::bar',
      mode: 'definition-near-start',
      candidates: [],
    },
  ],
  unknowns: ['project-ownership', 'runtime-coverage'],
});

const after = detectH19BlindSpots({
  inventory: afterInventory,
  focusFiles: ['preflight/verify_t1.py'],
  impacts: [{ scopeId: 'negative-controls', impact: afterImpact }],
  sourceRevision: revision,
});
validateH19BlindSpotLedger(after);

assert.equal(after.counts.total, 2);
assert.equal(after.counts.byCategory['semantic-unit-absence'], 0);
assert.equal(after.counts.byCategory['semantic-unit-symbol-unmatched'], 0);
assert.equal(after.counts.byCategory['impact-unknown'], 2);

const comparison = compareH19BlindSpotLedgers(before, after);
assert.equal(comparison.comparable, true);
assert.equal(comparison.counts.before, 5);
assert.equal(comparison.counts.after, 2);
assert.equal(comparison.counts.resolved, 4);
assert.equal(comparison.counts.persistent, 1);
assert.equal(comparison.counts.introduced, 1);
assert.equal(comparison.blindSpotReductionRate, 0.8);

const persistent = before.spots.find((spot) =>
  spot.category === 'impact-unknown' && spot.subject.unknown === 'project-ownership');
assert.ok(comparison.persistent.includes(persistent.blindSpotId));

const runtimeCoverage = after.spots.find((spot) =>
  spot.category === 'impact-unknown' && spot.subject.unknown === 'runtime-coverage');
assert.ok(comparison.introduced.includes(runtimeCoverage.blindSpotId));

const extractionFailure = detectH19BlindSpots({
  inventory: {
    version: 1,
    filesScanned: 1,
    units: [],
    errors: [{ path: 'broken.py', error: 'invalid syntax' }],
  },
  focusFiles: ['broken.py'],
  impacts: [],
  sourceRevision: revision,
});
assert.equal(extractionFailure.counts.total, 1);
assert.equal(extractionFailure.spots[0].category, 'extraction-error');
assert.equal(extractionFailure.counts.byCategory['semantic-unit-absence'], 0);

const replay = detectH19BlindSpots({
  inventory: beforeInventory,
  focusFiles: ['preflight/verify_t1.py'],
  impacts: [{ scopeId: 'negative-controls', impact: beforeImpact }],
  sourceRevision: revision,
});
assert.deepEqual(replay, before);

const tampered = structuredClone(before);
tampered.spots[0].reason = 'changed';
assert.throws(() => validateH19BlindSpotLedger(tampered), /ledger digest mismatch/);

const differentRevision = detectH19BlindSpots({
  inventory: afterInventory,
  focusFiles: ['preflight/verify_t1.py'],
  impacts: [{ scopeId: 'negative-controls', impact: afterImpact }],
  sourceRevision: 'b'.repeat(40),
});
const nonComparable = compareH19BlindSpotLedgers(before, differentRevision);
assert.equal(nonComparable.comparable, false);
assert.equal(nonComparable.blindSpotReductionRate, null);

assert.throws(
  () => detectH19BlindSpots({
    inventory: beforeInventory,
    focusFiles: [],
    impacts: [{ scopeId: '', impact: beforeImpact }],
  }),
  /scopeId and impact/,
);


const integrationRoot = await mkdtemp(path.join(os.tmpdir(), 'h19-blind-spot-integration-'));
try {
  await mkdir(path.join(integrationRoot, 'tests'), { recursive: true });
  await writeFile(path.join(integrationRoot, 'app.py'), [
    'def foo(x):',
    '    return x + 1',
    '',
    'def caller():',
    '    return foo(1)',
    '',
  ].join('\n'));
  await writeFile(path.join(integrationRoot, 'tests', 'test_app.py'), [
    'from app import foo',
    '',
    'def test_foo():',
    '    assert foo(1) == 2',
    '',
  ].join('\n'));

  const realInventory = await repositoryInventory(integrationRoot);
  const realUnits = realInventory.units.filter((unit) => unit.path === 'app.py');
  assert.equal(realUnits.length, 2);

  const realBeforeImpact = analyzeChangeImpact({
    changedFiles: ['app.py'],
    semanticUnits: realUnits,
    symbolGraph: null,
    coverageByPath: {},
    temporalCoupling: [],
  });
  const realBefore = detectH19BlindSpots({
    inventory: realInventory,
    focusFiles: ['app.py'],
    impacts: [{ scopeId: 'python-production-chain', impact: realBeforeImpact }],
    sourceRevision: revision,
  });

  assert.equal(
    realBefore.counts.byCategory['semantic-unit-symbol-unmatched'],
    2,
  );
  assert.ok(realBefore.spots.some((spot) =>
    spot.category === 'impact-unknown'
    && spot.subject.unknown === 'symbol-graph'));

  const realGraph = await buildPythonEvidenceGraph({ cwd: integrationRoot });
  const realAfterImpact = analyzeChangeImpact({
    changedFiles: ['app.py'],
    semanticUnits: realUnits,
    symbolGraph: realGraph.graph,
    coverageByPath: {},
    temporalCoupling: [],
  });
  const realAfter = detectH19BlindSpots({
    inventory: realInventory,
    focusFiles: ['app.py'],
    impacts: [{ scopeId: 'python-production-chain', impact: realAfterImpact }],
    sourceRevision: revision,
  });

  assert.equal(
    realAfter.counts.byCategory['semantic-unit-symbol-unmatched'],
    0,
  );
  assert.ok(!realAfter.spots.some((spot) =>
    spot.category === 'impact-unknown'
    && spot.subject.unknown === 'symbol-graph'));
  const runtimeCoverageSpots = realAfter.spots.filter((spot) =>
    spot.category === 'runtime-coverage-unknown-path');
  assert.equal(runtimeCoverageSpots.length, 2);
  assert.deepEqual(
    runtimeCoverageSpots.map((spot) => spot.subject.path).sort(),
    ['app.py', 'tests/test_app.py'],
  );

  const realComparison = compareH19BlindSpotLedgers(realBefore, realAfter);
  assert.equal(realComparison.comparable, true);
  assert.ok(realComparison.counts.resolved >= 4);
  assert.equal(realComparison.counts.persistent, 2);
  assert.equal(realComparison.counts.introduced, 2);
  assert.ok(realComparison.blindSpotReductionRate > 0);
} finally {
  await rm(integrationRoot, { recursive: true, force: true });
}

console.log('H19 blind-spot production-chain integration: real inventory -> Python graph -> M4 -> ledger comparison PASS');

console.log('H19 blind-spot ledger: deterministic candidates, resolution/persistence/introduction tracking, extraction precedence and comparison boundaries PASS');
