import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  inspectScipArtifactCache,
  pruneScipArtifactCache,
} from '../src/indexing/cache-prune.mjs';

const temp = path.join(os.tmpdir(), `h19-prune-${process.pid}-${Date.now()}`);
const root = path.join(temp, 'artifacts');
try {
  const namespace = path.join(root, 'scip-project-v1');

  async function entry(key, config, createdAt, bytes) {
    const dir = path.join(namespace, key);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.scip'), Buffer.alloc(bytes, 1));
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      projectRoot: '.',
      createdAt,
      indexer: {
        id: 'scip-typescript',
        version: '0.4.0',
        flags: ['-p', config],
      },
    }));
  }

  for (let i = 0; i < 5; i++) {
    await entry(`app-${i}`, 'tsconfig.app.json', `2026-09-2${i + 1}T00:00:00Z`, 100);
  }
  for (let i = 0; i < 2; i++) {
    await entry(`worker-${i}`, 'tsconfig.worker.json', `2026-09-2${i + 1}T00:00:00Z`, 100);
  }

  assert.equal((await inspectScipArtifactCache({ root })).length, 7);

  const report = await pruneScipArtifactCache({
    root,
    keepPerShard: 2,
    maxBytes: 10_000,
  });
  assert.equal(report.logicalShards, 2);
  assert.equal(report.beforeEntries, 7);
  assert.equal(report.afterEntries, 4);
  assert.equal(report.removedEntries, 3);

  const remaining = await inspectScipArtifactCache({ root });
  assert.deepEqual(
    remaining.filter((x) => x.manifest.indexer.flags[1] === 'tsconfig.app.json').map((x) => x.key).sort(),
    ['app-3','app-4'],
  );
  assert.deepEqual(
    remaining.filter((x) => x.manifest.indexer.flags[1] === 'tsconfig.worker.json').map((x) => x.key).sort(),
    ['worker-0','worker-1'],
  );

  const pressured = await pruneScipArtifactCache({
    root,
    keepPerShard: 2,
    maxBytes: 300,
  });
  assert.equal(pressured.afterEntries, 2);
  assert.equal(pressured.logicalShards, 2);
  assert.equal(pressured.overBudgetUnavoidable, false);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit cache prune smoke: ok');
