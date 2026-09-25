import assert from 'node:assert/strict';

import {
  compareScipDocumentEvidence,
  mergeScipIndexes,
} from '../src/graph/merge-scip-indexes.mjs';
import { buildSymbolGraph } from '../src/graph/symbol-graph.mjs';

const a = {
  documents: [{
    relative_path: 'src/a.ts',
    language: 'typescript',
    occurrences: [{
      symbol: 'demo/a#',
      symbol_roles: 1,
      range: [0, 0, 1],
    }],
    symbols: [{
      symbol: 'demo/a#',
      display_name: 'a',
      kind: 17,
      relationships: [],
    }],
  }],
};

const b = {
  documents: [{
    relative_path: 'src/b.ts',
    language: 'typescript',
    occurrences: [{
      symbol: 'demo/a#',
      symbol_roles: 8,
      range: [1, 0, 1],
    }],
    symbols: [],
  }],
};

const merged = mergeScipIndexes([a, b]);
assert.equal(merged.conflicts.length, 0);
assert.equal(merged.index.documents.length, 2);

const expected = {
  documents: [...a.documents, ...b.documents],
};

const comparison = compareScipDocumentEvidence(expected, merged.index);
assert.equal(comparison.exact, true);

const graph = buildSymbolGraph(merged.index);
assert.equal(graph.nodeCount, 1);
assert.equal(graph.nodes[0].definitions.length, 1);
assert.equal(graph.nodes[0].references.length, 1);
assert.equal(graph.nodes[0].definitions[0].path, 'src/a.ts');
assert.equal(graph.nodes[0].references[0].path, 'src/b.ts');

const conflict = mergeScipIndexes([
  a,
  {
    documents: [{
      relative_path: 'src/a.ts',
      language: 'typescript',
      occurrences: [{
        symbol: 'demo/other#',
        symbol_roles: 1,
        range: [0, 0, 1],
      }],
      symbols: [],
    }],
  },
]);
assert.equal(conflict.conflicts.length, 1);

console.log('h19-kit SCIP graph-equivalence smoke: ok');
