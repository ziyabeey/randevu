import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  inspectGraphCache,
  pruneGraphCache,
} from '../src/indexing/graph-cache-prune.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'h19-graph-prune-'));
try {
  const ns = path.join(root, 'ts-project-graph-v1');
  await mkdir(ns, { recursive: true });

  for (let i = 0; i < 5; i++) {
    const file = path.join(ns, `graph-${i}.json`);
    await writeFile(file, JSON.stringify({ i, payload: 'x'.repeat(100) }));
    const stamp = new Date(Date.UTC(2026, 8, 20 + i));
    const { utimes } = await import('node:fs/promises');
    await utimes(file, stamp, stamp);
  }

  assert.equal((await inspectGraphCache({ root })).length, 5);

  const report = await pruneGraphCache({
    root,
    keep: 2,
    maxBytes: 10_000,
  });
  assert.equal(report.beforeEntries, 5);
  assert.equal(report.afterEntries, 2);
  assert.equal(report.removedEntries, 3);

  const remaining = await inspectGraphCache({ root });
  assert.deepEqual(remaining.map((x) => x.key), ['graph-4', 'graph-3']);

  const pressure = await pruneGraphCache({
    root,
    keep: 2,
    maxBytes: 1,
  });
  assert.equal(pressure.afterEntries, 1);
  assert.equal(pressure.overBudgetUnavoidable, true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('h19-kit graph-cache prune smoke: ok');
