import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractPythonUnits } from '../src/extractors/python-units.mjs';
import { buildPythonEvidenceGraph } from '../src/indexing/python-evidence-graph.mjs';
import { symbolsForSemanticUnits } from '../src/impact/unit-symbol-map.mjs';

const procedural = [
  '#!/usr/bin/env python3',
  '"""procedural module fixture"""',
  'import sys',
  'from pathlib import Path',
  '',
  'ROOT = Path(sys.argv[1])',
  'result = {}',
  'for item in ROOT.iterdir():',
  '    result[item.name] = item.is_file()',
  'print(len(result))',
  'sys.exit(0)',
  '',
].join('\n');

const moduleUnits = await extractPythonUnits(procedural, { path: 'preflight/check.py' });
assert.equal(moduleUnits.length, 1);
assert.equal(moduleUnits[0].kind, 'Module');
assert.equal(moduleUnits[0].symbol, '<module>');
assert.equal(moduleUnits[0].language, 'python');
assert.equal(moduleUnits[0].path, 'preflight/check.py');
assert.equal(moduleUnits[0].startLine, 6);
assert.equal(moduleUnits[0].endLine, 11);
assert.ok(moduleUnits[0].definition.includes('ROOT = Path(sys.argv[1])'));
assert.ok(moduleUnits[0].definition.includes('sys.exit(0)'));
assert.ok(!moduleUnits[0].definition.includes('import sys'));
assert.match(moduleUnits[0].digest, /^[a-f0-9]{64}$/);

const declarationsOnly = [
  '"""library marker"""',
  'import os',
  'from pathlib import Path',
  '',
].join('\n');
assert.deepEqual(
  await extractPythonUnits(declarationsOnly, { path: 'pkg/empty.py' }),
  [],
);

const functionBearing = [
  'import sys',
  '',
  'def main():',
  '    return 1',
  '',
  'print(main())',
  '',
].join('\n');
const functionUnits = await extractPythonUnits(functionBearing, { path: 'pkg/app.py' });
assert.equal(functionUnits.length, 1);
assert.equal(functionUnits[0].kind, 'FunctionDef');
assert.equal(functionUnits[0].symbol, 'main');

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-python-module-unit-'));
try {
  await mkdir(path.join(temp, 'preflight'), { recursive: true });
  await writeFile(path.join(temp, 'preflight', 'check.py'), procedural);

  const built = await buildPythonEvidenceGraph({ cwd: temp });
  const moduleNode = built.graph.nodes.find((node) =>
    node.kind === 'module' && node.symbol === 'python preflight.check::<module>');
  assert.ok(moduleNode);

  const mapping = symbolsForSemanticUnits(built.graph, moduleUnits);
  assert.equal(mapping.unmatched.length, 0);
  assert.equal(mapping.matches.length, 1);
  assert.equal(mapping.matches[0].mode, 'python-module');
  assert.equal(mapping.matches[0].symbol, 'python preflight.check::<module>');
  assert.deepEqual(mapping.symbols, ['python preflight.check::<module>']);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('H19 Python module fallback units: conservative extraction and deterministic module-symbol mapping PASS');
