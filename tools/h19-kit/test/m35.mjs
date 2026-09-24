import assert from 'node:assert/strict';

import { CodeGraph } from '../src/graph/code-graph.mjs';
import { normalizeScipIndex, scipImpact } from '../src/adapters/scip.mjs';
import { parseTreeSitterTags, treeSitterTagsGraph } from '../src/adapters/tree-sitter-tags.mjs';
import { parseNxAffected } from '../src/adapters/nx-affected.mjs';
import { parseTurboAffected } from '../src/adapters/turbo-affected.mjs';
import { scipImpactEvidence, workspaceAffectedEvidence } from '../src/adapters/code-impact-evidence.mjs';

const symbol = 'scip-typescript npm demo 1.0.0 src/a.ts/foo().';
const scip = normalizeScipIndex({
  documents: [
    {
      relative_path: 'src/a.ts',
      language: 'typescript',
      symbols: [{ symbol, display_name: 'foo', relationships: [] }],
      occurrences: [{ range: [0, 0, 3], symbol, symbol_roles: 1 }],
    },
    {
      relative_path: 'src/b.ts',
      language: 'typescript',
      occurrences: [{ single_line_range: { line: 2, start_character: 4, end_character: 7 }, symbol, symbol_roles: 8 }],
    },
  ],
});
assert.equal(scip.nodes('document').length, 2);
assert.equal(scip.edges('scip:defines').length, 1);
assert.equal(scip.edges('scip:references').length, 1);
assert.deepEqual(scip.edges('scip:references')[0].range, [2, 4, 7]);
const impact = scipImpact(scip, ['src/a.ts']);
assert.deepEqual(impact.affectedDocuments, ['doc:src/a.ts', 'doc:src/b.ts']);
assert.equal(impact.changedSymbols.length, 1);
const impactEvidence = scipImpactEvidence(impact);
assert.equal(impactEvidence.find((x) => x.id === 'impact.cross_file').state, 'present');

const tagRows = parseTreeSitterTags(`
src/demo.py
    Demo             | class        def (0, 6) - (0, 10) \`class Demo:\`
    run              | method       def (1, 8) - (1, 11) \`def run(self):\`
src/use.py
    run              | call         ref (3, 0) - (3, 3) \`run()\`
`);
assert.equal(tagRows.length, 3);
const tagGraph = treeSitterTagsGraph(tagRows);
assert.equal(tagGraph.nodes('syntax-symbol').length, 3);
assert.ok(tagGraph.edges().every((x) => x.precision === 'syntax-only'));

assert.deepEqual(
  parseNxAffected('api,web\nshared\napi\n'),
  ['api', 'shared', 'web'],
);

const turbo = parseTurboAffected({
  data: {
    affectedPackages: {
      items: [
        { name: '@demo/ui', path: 'packages/ui', reason: { __typename: 'FileChanged' } },
        { name: '@demo/web', path: 'apps/web', reason: { __typename: 'DependencyChanged' } },
      ],
      length: 2,
    },
    affectedTasks: {
      items: [
        { name: 'test', package: '@demo/ui' },
      ],
      length: 1,
    },
  },
});
assert.equal(turbo.packages.length, 2);
assert.equal(turbo.tasks.length, 1);
assert.equal(turbo.packages[0].name, '@demo/ui');
assert.equal(workspaceAffectedEvidence(turbo)[0].state, 'present');

const graph = new CodeGraph();
graph.addNode('a', 'symbol');
graph.addNode('b', 'symbol');
graph.addNode('c', 'symbol');
graph.addEdge('a', 'b', 'calls');
graph.addEdge('b', 'c', 'calls');
assert.deepEqual(graph.impactClosure(['a'], { kinds: 'calls', direction: 'out' }), ['a', 'b', 'c']);

console.log('h19-kit M3.5 code-intelligence smoke: ok');
