import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  extractPythonUnits,
  extractPythonUnitsBatch,
} from '../src/extractors/python-units.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';

const files = [
  {
    path: 'pkg/a.py',
    text: [
      'def foo(x):',
      '    return x + 1',
      '',
    ].join('\n'),
  },
  {
    path: 'scripts/check.py',
    text: [
      'import sys',
      'VALUE = int(sys.argv[1])',
      'print(VALUE)',
      '',
    ].join('\n'),
  },
  {
    path: 'pkg/bad.py',
    text: 'def broken(:\n    pass\n',
  },
];

const singleA = await extractPythonUnits(files[0].text, { path: files[0].path });
const singleCheck = await extractPythonUnits(files[1].text, { path: files[1].path });

const batch = await extractPythonUnitsBatch(files);
assert.deepEqual(batch.results.map((row) => row.path), ['pkg/a.py', 'scripts/check.py']);
assert.deepEqual(batch.results[0].units, singleA);
assert.deepEqual(batch.results[1].units, singleCheck);
assert.equal(batch.results[1].units.length, 1);
assert.equal(batch.results[1].units[0].kind, 'Module');
assert.equal(batch.errors.length, 1);
assert.equal(batch.errors[0].path, 'pkg/bad.py');
assert.match(batch.errors[0].error, /invalid syntax/i);

const again = await extractPythonUnitsBatch(files);
assert.deepEqual(again, batch);

await assert.rejects(
  extractPythonUnitsBatch([{ path: 'x.py', text: 42 }]),
  /path and text strings/,
);

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-python-batch-'));
try {
  await mkdir(path.join(temp, 'pkg'), { recursive: true });
  await mkdir(path.join(temp, 'scripts'), { recursive: true });
  for (const file of files) {
    await writeFile(path.join(temp, file.path), file.text);
  }

  const inventory = await repositoryInventory(temp);
  assert.equal(inventory.filesScanned, 3);
  assert.equal(inventory.errors.length, 1);
  assert.equal(inventory.errors[0].path, 'pkg/bad.py');
  assert.equal(inventory.units.length, 2);

  const foo = inventory.units.find((unit) => unit.path === 'pkg/a.py');
  const module = inventory.units.find((unit) => unit.path === 'scripts/check.py');
  assert.equal(foo?.kind, 'FunctionDef');
  assert.equal(foo?.symbol, 'foo');
  assert.equal(module?.kind, 'Module');
  assert.equal(module?.symbol, '<module>');
  assert.deepEqual(inventory.units, [...inventory.units].sort((a, b) =>
    a.path.localeCompare(b.path) || (a.startLine ?? 0) - (b.startLine ?? 0)));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('H19 Python batch extraction: single-file equivalence, per-file failure isolation, deterministic replay and inventory adoption PASS');
