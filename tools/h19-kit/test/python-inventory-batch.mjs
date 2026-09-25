import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  extractPythonUnits,
  extractPythonUnitsBatch,
} from '../src/extractors/python-units.mjs';
import { buildPythonEvidenceGraph } from '../src/indexing/python-evidence-graph.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';
import { symbolsForSemanticUnits } from '../src/impact/unit-symbol-map.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-python-batch-'));
try {
  const funcs = [
    'def first():',
    '    return 1',
    '',
    'def second():',
    '    return first()',
    '',
  ].join('\n');
  const moduleOnly = [
    'value = 41',
    'print(value + 1)',
    '',
  ].join('\n');

  await writeFile(path.join(temp, 'funcs.py'), funcs);
  await writeFile(path.join(temp, 'module_only.py'), moduleOnly);
  await writeFile(path.join(temp, 'bad.py'), 'def broken(:\n    pass\n');

  const direct = await extractPythonUnits(moduleOnly, { path: 'module_only.py' });
  assert.deepEqual(direct, [], 'single-file extractor must preserve function-only behavior');

  const explicitBatch = await extractPythonUnitsBatch([
    { path: 'funcs.py', text: funcs },
    { path: 'module_only.py', text: moduleOnly },
  ], { includeModuleUnits: true });
  assert.equal(explicitBatch.filesAttempted, 2);
  assert.equal(explicitBatch.filesParsed, 2);
  assert.equal(explicitBatch.errors.length, 0);
  assert.equal(explicitBatch.units.filter((unit) => unit.path === 'funcs.py').length, 2);
  assert.equal(explicitBatch.units.some((unit) =>
    unit.path === 'funcs.py' && unit.kind === 'Module'), false);
  assert.deepEqual(
    explicitBatch.units
      .filter((unit) => unit.path === 'module_only.py')
      .map((unit) => ({ kind: unit.kind, symbol: unit.symbol, startLine: unit.startLine })),
    [{ kind: 'Module', symbol: '<module>', startLine: 1 }],
  );

  const countFile = path.join(temp, 'python-spawns.txt');
  const wrapper = path.join(temp, 'python-wrapper.sh');
  await writeFile(wrapper, [
    '#!/bin/sh',
    `printf 'spawn\\n' >> "${countFile}"`,
    'exec python3 "$@"',
    '',
  ].join('\n'));
  await chmod(wrapper, 0o755);

  const inventory = await repositoryInventory(temp, {
    pythonExecutables: [wrapper],
  });
  assert.equal(inventory.filesScanned, 3);
  assert.equal(inventory.errors.length, 1);
  assert.equal(inventory.errors[0].path, 'bad.py');
  assert.match(inventory.errors[0].error, /SyntaxError/);
  assert.equal(inventory.units.filter((unit) => unit.path === 'funcs.py').length, 2);
  assert.equal(inventory.units.some((unit) =>
    unit.path === 'funcs.py' && unit.kind === 'Module'), false);

  const moduleUnits = inventory.units.filter((unit) => unit.path === 'module_only.py');
  assert.equal(moduleUnits.length, 1);
  assert.equal(moduleUnits[0].kind, 'Module');
  assert.equal(moduleUnits[0].symbol, '<module>');
  assert.equal(moduleUnits[0].definition, moduleOnly);

  const spawnLines = (await readFile(countFile, 'utf8')).trim().split(/\r?\n/);
  assert.equal(spawnLines.length, 1, 'repository inventory must use one Python process for the batch');

  await unlink(path.join(temp, 'bad.py'));
  const graph = (await buildPythonEvidenceGraph({ cwd: temp })).graph;
  const mapped = symbolsForSemanticUnits(graph, moduleUnits);
  assert.equal(mapped.unmatched.length, 0);
  assert.deepEqual(mapped.symbols, ['python module_only::<module>']);
  assert.equal(mapped.matches[0].mode, 'definition-near-start');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('H19 Python inventory batch: one process, isolated parse errors, function-count stability and module-only mapping PASS');
