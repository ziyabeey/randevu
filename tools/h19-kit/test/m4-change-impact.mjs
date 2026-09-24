import assert from 'node:assert/strict';

import { SCIP_ROLES } from '../src/adapters/scip.mjs';
import { buildSymbolGraph } from '../src/graph/symbol-graph.mjs';
import { projectGraph } from '../src/impact/project-graph.mjs';
import { analyzeChangeImpact, isLikelyTestPath } from '../src/impact/change-impact.mjs';

const method = 'typescript npm demo 1.0.0 packages/lib/src/a.ts/Foo#do().';

assert.equal(isLikelyTestPath('apps/app/src/a.test.ts'), true);
assert.equal(isLikelyTestPath('tests/bookings-http.mjs'), true);
assert.equal(isLikelyTestPath('pkg/foo_test.go'), true);
assert.equal(isLikelyTestPath('src/contest.ts'), false);
assert.equal(isLikelyTestPath('src/latest.ts'), false);
assert.equal(isLikelyTestPath('src/foo.ts'), false);

const symbols = buildSymbolGraph({
  documents: [{
    relative_path: 'packages/lib/src/a.ts',
    symbols: [{ symbol: method, display_name: 'do', kind: 17 }],
    occurrences: [{
      symbol: method,
      symbol_roles: SCIP_ROLES.DEFINITION,
      range: [5, 2, 5, 4],
      enclosing_range: [5, 0, 10, 1],
    }],
  }, {
    relative_path: 'apps/app/src/a.test.ts',
    occurrences: [{
      symbol: method,
      symbol_roles: SCIP_ROLES.READ,
      range: [3, 1, 3, 5],
    }],
  }],
});

const projects = projectGraph({
  projects: [
    { id: 'app', root: 'apps/app' },
    { id: 'lib', root: 'packages/lib' },
  ],
  dependencies: [{ source: 'app', target: 'lib' }],
});

const result = analyzeChangeImpact({
  projectGraph: projects,
  changedFiles: ['packages/lib/src/a.ts'],
  semanticUnits: [{
    id: 'packages/lib/src/a.ts::Foo.do@6',
    path: 'packages/lib/src/a.ts',
    startLine: 6,
    endLine: 11,
  }],
  symbolGraph: symbols,
  coverageByPath: { 'apps/app/src/a.test.ts': false },
});

assert.deepEqual(result.projectImpact.touched, ['lib']);
assert.deepEqual(result.projectImpact.affected, ['app', 'lib']);
assert.deepEqual(result.symbolImpact.mapping.symbols, [method]);
assert.deepEqual(result.symbolImpact.report.uncoveredPaths, ['apps/app/src/a.test.ts']);
assert.deepEqual(result.candidateTests, [{
  path: 'apps/app/src/a.test.ts',
  reason: 'test-reference-and-explicitly-uncovered',
}]);
assert.deepEqual(result.unknowns, []);
assert.equal(result.safeToNarrow, true);

const failClosed = analyzeChangeImpact({
  changedFiles: ['README.md'],
  semanticUnits: [{
    id: 'missing::x@1',
    path: 'missing.ts',
    startLine: 1,
    endLine: 1,
  }],
  symbolGraph: symbols,
});

assert.equal(failClosed.safeToNarrow, false);
assert.ok(failClosed.unknowns.includes('project-graph'));
assert.ok(failClosed.unknowns.includes('project-ownership'));
assert.ok(failClosed.unknowns.includes('semantic-unit-symbol-mapping'));

console.log('h19-kit M4 change-impact orchestrator smoke: ok');
