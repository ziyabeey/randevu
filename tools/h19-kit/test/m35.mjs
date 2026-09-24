import assert from 'node:assert/strict';

import { buildSymbolGraph, symbolNode } from '../src/graph/symbol-graph.mjs';
import { referenceBlastRadius } from '../src/impact/blast-radius.mjs';
import { blastRadiusEvidence } from '../src/impact/evidence.mjs';
import { SCIP_ROLES } from '../src/adapters/scip.mjs';

const foo = 'typescript npm demo 1.0.0 src/a.ts/foo().';
const iface = 'typescript npm demo 1.0.0 src/types.ts/Foo#';

const index = {
  metadata: { projectRoot: 'file:///repo' },
  documents: [
    {
      relativePath: 'src/a.ts',
      language: 'typescript',
      symbols: [{
        symbol: foo,
        displayName: 'foo',
        kind: 17,
        relationships: [{ symbol: iface, isImplementation: true }],
      }],
      occurrences: [{
        symbol: foo,
        symbolRoles: SCIP_ROLES.DEFINITION,
        singleLineRange: { line: 0, startCharacter: 16, endCharacter: 19 },
      }],
    },
    {
      relativePath: 'src/b.ts',
      language: 'typescript',
      occurrences: [{
        symbol: foo,
        symbolRoles: SCIP_ROLES.READ,
        singleLineRange: { line: 4, startCharacter: 2, endCharacter: 5 },
      }],
    },
    {
      relativePath: 'test/a.test.ts',
      language: 'typescript',
      occurrences: [{
        symbol: foo,
        symbolRoles: SCIP_ROLES.TEST | SCIP_ROLES.READ,
        singleLineRange: { line: 8, startCharacter: 9, endCharacter: 12 },
      }],
    },
  ],
};

const graph = buildSymbolGraph(index);
assert.equal(graph.nodeCount, 2);
assert.equal(symbolNode(graph, foo).definitions.length, 1);
assert.equal(symbolNode(graph, foo).references.length, 2);

const report = referenceBlastRadius({
  graph,
  changedSymbols: [foo],
  changedPaths: ['src/a.ts'],
  coverageByPath: {
    'src/b.ts': false,
    'test/a.test.ts': true,
  },
  temporalCoupling: [{
    a: 'src/a.ts',
    b: 'src/ledger.ts',
    shared: 8,
    confidenceAtoB: 0.85,
    confidenceBtoA: 0.60,
  }],
});

assert.equal(report.referenceSiteCount, 2);
assert.deepEqual(report.impactedPaths, ['src/b.ts', 'test/a.test.ts']);
assert.deepEqual(report.uncoveredPaths, ['src/b.ts']);
assert.deepEqual(report.testReferencePaths, ['test/a.test.ts']);
assert.equal(report.coverageComplete, true);
assert.equal(report.historicalCompanionsMissing.length, 1);
assert.equal(report.historicalCompanionsMissing[0].missing, 'src/ledger.ts');
assert.ok(report.caveats.some((x) => x.includes('not assumed to be call edges')));

const evidences = blastRadiusEvidence(report);
assert.equal(evidences.find((x) => x.id === 'impact.references.present').state, 'present');
assert.equal(evidences.find((x) => x.id === 'impact.coverage_gap.present').state, 'present');
assert.equal(evidences.find((x) => x.id === 'impact.test_references.present').state, 'present');
assert.equal(evidences.find((x) => x.id === 'history.companion.missing').state, 'present');

const unknownCoverage = referenceBlastRadius({
  graph,
  changedSymbols: [foo],
  changedPaths: ['src/a.ts'],
  coverageByPath: {},
});
const unknownEvidence = blastRadiusEvidence(unknownCoverage)
  .find((x) => x.id === 'impact.coverage_gap.present');
assert.equal(unknownEvidence.state, 'unknown');

console.log('h19-kit M3.5 SCIP blast-radius smoke: ok');
