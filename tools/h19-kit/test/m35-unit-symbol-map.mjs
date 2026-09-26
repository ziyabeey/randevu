import assert from 'node:assert/strict';

import { normalizeScipRange, SCIP_ROLES } from '../src/adapters/scip.mjs';
import { buildSymbolGraph } from '../src/graph/symbol-graph.mjs';
import {
  symbolsForSemanticUnits,
  unitSymbolMappingEvidence,
} from '../src/impact/unit-symbol-map.mjs';
import { referenceBlastRadiusForUnits } from '../src/impact/blast-radius.mjs';

assert.deepEqual(normalizeScipRange([2, 3, 7]), {
  startLine: 2,
  startCharacter: 3,
  endLine: 2,
  endCharacter: 7,
});
assert.deepEqual(normalizeScipRange([2, 3, 5, 9]), {
  startLine: 2,
  startCharacter: 3,
  endLine: 5,
  endCharacter: 9,
});
assert.deepEqual(normalizeScipRange({
  start_line: 5,
  start_character: 1,
  end_line: 10,
  end_character: 2,
}), {
  startLine: 5,
  startCharacter: 1,
  endLine: 10,
  endCharacter: 2,
});

const cls = 'typescript npm demo 1.0.0 src/a.ts/Foo#';
const method = 'typescript npm demo 1.0.0 src/a.ts/Foo#do().';
const index = {
  documents: [{
    relative_path: 'src/a.ts',
    symbols: [
      { symbol: cls, display_name: 'Foo', kind: 7 },
      { symbol: method, display_name: 'do', kind: 17 },
    ],
    occurrences: [
      {
        symbol: cls,
        symbol_roles: SCIP_ROLES.DEFINITION,
        single_line_range: { line: 0, start_character: 6, end_character: 9 },
        multi_line_enclosing_range: {
          start_line: 0,
          start_character: 0,
          end_line: 20,
          end_character: 1,
        },
      },
      {
        symbol: method,
        symbol_roles: SCIP_ROLES.DEFINITION,
        single_line_range: { line: 5, start_character: 2, end_character: 4 },
        multi_line_enclosing_range: {
          start_line: 5,
          start_character: 0,
          end_line: 10,
          end_character: 1,
        },
      },
    ],
  }, {
    relativePath: 'src/b.ts',
    occurrences: [{
      symbol: method,
      symbolRoles: SCIP_ROLES.READ,
      range: [3, 1, 3, 5],
    }],
  }],
};

const graph = buildSymbolGraph(index);
const units = [{
  id: 'src/a.ts::Foo.do@6',
  path: 'src/a.ts',
  startLine: 6,
  endLine: 11,
}];

const mapping = symbolsForSemanticUnits(graph, units);
assert.deepEqual(mapping.symbols, [method]);
assert.equal(mapping.matches[0].mode, 'enclosing-range');
assert.equal(mapping.matches[0].candidates[0].symbol, method);
assert.ok(mapping.matches[0].candidates.some((x) => x.symbol === cls));
assert.equal(mapping.unmatched.length, 0);
assert.equal(unitSymbolMappingEvidence(mapping).state, 'absent');

const blast = referenceBlastRadiusForUnits({
  graph,
  units,
  changedPaths: ['src/a.ts'],
  coverageByPath: { 'src/b.ts': false },
});
assert.deepEqual(blast.mapping.symbols, [method]);
assert.equal(blast.report.referenceSiteCount, 1);
assert.deepEqual(blast.report.uncoveredPaths, ['src/b.ts']);

const unmatched = symbolsForSemanticUnits(graph, [{
  id: 'src/missing.ts::x@1',
  path: 'src/missing.ts',
  startLine: 1,
  endLine: 2,
}]);
assert.equal(unmatched.symbols.length, 0);
assert.deepEqual(unmatched.unmatched, ['src/missing.ts::x@1']);
assert.equal(unitSymbolMappingEvidence(unmatched).state, 'present');

console.log('h19-kit M3.5 unit-to-SCIP-symbol smoke: ok');
