import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { repositoryInventory } from '../src/repository/inventory.mjs';
import { buildPythonEvidenceGraph } from '../src/indexing/python-evidence-graph.mjs';
import { projectGraph } from '../src/impact/project-graph.mjs';
import { analyzeChangeImpact } from '../src/impact/change-impact.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-python-graph-'));
try {
  await mkdir(path.join(temp, 'pkg'), { recursive: true });
  await mkdir(path.join(temp, 'tests'), { recursive: true });

  await writeFile(path.join(temp, 'pkg', 'a.py'), [
    'def foo(x):',
    '    return x + 1',
    '',
    'def caller():',
    '    return foo(1)',
    '',
  ].join('\n'));

  await writeFile(path.join(temp, 'pkg', 'b.py'), [
    'from .a import foo',
    '',
    'def bar():',
    '    return foo(2)',
    '',
  ].join('\n'));

  await writeFile(path.join(temp, 'tests', 'test_a.py'), [
    'from pkg.a import foo',
    '',
    'def test_foo():',
    '    assert foo(1) == 2',
    '',
  ].join('\n'));

  const inventory = await repositoryInventory(temp);
  assert.equal(inventory.errors.length, 0);
  const changedUnits = inventory.units.filter((unit) => unit.path === 'pkg/a.py');
  assert.equal(changedUnits.length, 2);

  const built = await buildPythonEvidenceGraph({ cwd: temp });
  assert.equal(built.mode, 'python-ast');
  assert.equal(built.project.sourceFiles, 3);
  assert.equal(built.graph.metadata.definitionCount, 4);
  assert.ok(built.graph.nodeCount >= 7);

  const foo = built.graph.nodes.find((node) => node.symbol === 'python pkg.a::foo');
  assert.ok(foo);
  assert.equal(foo.definitions.length, 1);
  assert.ok(foo.references.some((ref) => ref.path === 'pkg/a.py'));
  assert.ok(foo.references.some((ref) => ref.path === 'pkg/b.py'));
  assert.ok(foo.references.some((ref) => ref.path === 'tests/test_a.py' && ref.isTest));

  const impact = analyzeChangeImpact({
    projectGraph: projectGraph({
      projects: [{ id: 'fixture', root: '' }],
      dependencies: [],
    }),
    changedFiles: ['pkg/a.py'],
    semanticUnits: changedUnits,
    symbolGraph: built.graph,
    coverageByPath: {},
    temporalCoupling: [],
  });

  assert.equal(impact.symbolImpact.mapping.unmatched.length, 0);
  assert.equal(impact.symbolImpact.mapping.matches.length, 2);
  assert.ok(impact.symbolImpact.report.referenceSiteCount >= 3);
  assert.ok(impact.symbolImpact.report.impactedPaths.includes('pkg/b.py'));
  assert.ok(impact.symbolImpact.report.impactedPaths.includes('tests/test_a.py'));
  assert.ok(impact.symbolImpact.report.testReferencePaths.includes('tests/test_a.py'));
  assert.ok(impact.candidateTests.some((row) =>
    row.path === 'tests/test_a.py'
    && row.reason === 'test-reference-with-unknown-runtime-coverage'));
  assert.deepEqual(impact.unknowns, ['runtime-coverage']);
  assert.equal(impact.safeToNarrow, false);

  const again = await buildPythonEvidenceGraph({ cwd: temp });
  assert.deepEqual(again.graph, built.graph);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('H19 Python AST evidence graph: unit mapping, local/import references, test-path impact and deterministic replay PASS');
