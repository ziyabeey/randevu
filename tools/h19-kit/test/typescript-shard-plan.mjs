import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import {
  materializeTypeScriptShardPlan,
  planTypeScriptShardIndexes,
} from '../src/indexing/typescript-shard-plan.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-ts-plan-'));
try {
  await mkdir(path.join(temp, 'src'), { recursive: true });
  await mkdir(path.join(temp, 'worker'), { recursive: true });
  await mkdir(path.join(temp, 'scripts'), { recursive: true });
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}\n');
  await writeFile(path.join(temp, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext' },
    files: [],
    references: [
      { path: './tsconfig.app.json' },
      { path: './tsconfig.worker.json' },
    ],
  }));
  await writeFile(path.join(temp, 'tsconfig.app.json'), JSON.stringify({
    extends: './tsconfig.json',
    include: ['src'],
  }));
  await writeFile(path.join(temp, 'tsconfig.worker.json'), JSON.stringify({
    extends: './tsconfig.json',
    include: ['worker'],
  }));
  await writeFile(path.join(temp, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(temp, 'worker', 'b.ts'), 'export const b = 2;\n');
  await writeFile(path.join(temp, 'scripts', 'ignored.mjs'), 'export const ignored = true;\n');

  const cache = new ArtifactCache(path.join(temp, '.h19', 'artifacts'));
  const coldPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache,
    scipVersion: '0.4.0-test',
    scipCommand: 'binary-that-does-not-exist',
  });
  assert.equal(coldPlan.shardCount, 2);
  assert.equal(coldPlan.hits, 0);
  assert.equal(coldPlan.misses, 2);
  assert.equal(coldPlan.allHit, false);

  let executions = 0;
  const execute = async (_command, args) => {
    executions += 1;
    const outputIndex = args.indexOf('--output') + 1;
    assert.ok(outputIndex > 0);
    await writeFile(args[outputIndex], Buffer.from(`fake-scip-${executions}`));
    return { code: 0, stdout: '', stderr: '' };
  };

  const appOnly = {
    ...coldPlan,
    hits: 1,
    misses: 1,
    allHit: false,
    missingShardIds: ['tsconfig.app.json'],
    rows: coldPlan.rows.map((row) => row.id === 'tsconfig.app.json'
      ? row
      : Object.freeze({
          ...row,
          cache: 'hit',
          indexFile: cache.fileFor('scip-project-v1', row.fingerprint, 'index.scip'),
        })),
  };

  // Seed the worker artifact manually; planner itself has not invoked any indexer.
  const worker = coldPlan.rows.find((row) => row.id === 'tsconfig.worker.json');
  const seed = path.join(temp, 'worker.scip');
  await writeFile(seed, Buffer.from('worker-seed'));
  await cache.putFile('scip-project-v1', worker.fingerprint, 'index.scip', seed, {
    fingerprint: worker.fingerprint,
  });

  const materialized = await materializeTypeScriptShardPlan({
    cwd: temp,
    plan: appOnly,
    cache,
    execute,
  });
  assert.equal(executions, 1);
  assert.equal(materialized.indexed, 1);
  assert.equal(materialized.reused, 1);

  const warmPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache,
    scipVersion: '0.4.0-test',
    scipCommand: 'binary-that-does-not-exist',
  });
  assert.equal(warmPlan.hits, 2);
  assert.equal(warmPlan.misses, 0);
  assert.equal(warmPlan.allHit, true);
  assert.equal(executions, 1);

  await writeFile(path.join(temp, 'src', 'a.ts'), 'export const a = 3;\n');
  const changedPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache,
    scipVersion: '0.4.0-test',
    scipCommand: 'binary-that-does-not-exist',
  });
  assert.deepEqual(changedPlan.missingShardIds, ['tsconfig.app.json']);
  assert.equal(changedPlan.rows.find((x) => x.id === 'tsconfig.worker.json').cache, 'hit');

  const changedAppFingerprint = changedPlan.rows.find((x) => x.id === 'tsconfig.app.json').fingerprint;
  await writeFile(path.join(temp, 'scripts', 'ignored.mjs'), 'export const ignored = false;\n');
  const ignoredPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache,
    scipVersion: '0.4.0-test',
    scipCommand: 'binary-that-does-not-exist',
  });
  assert.deepEqual(ignoredPlan.missingShardIds, ['tsconfig.app.json']);
  assert.equal(ignoredPlan.rows.find((x) => x.id === 'tsconfig.worker.json').cache, 'hit');
  assert.equal(
    ignoredPlan.rows.find((x) => x.id === 'tsconfig.app.json').fingerprint,
    changedAppFingerprint,
  );

  await assert.rejects(
    () => planTypeScriptShardIndexes({ cwd: temp, cache, scipVersion: 'auto' }),
    /exact configured SCIP TypeScript version/,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit TypeScript shard cache-plan smoke: ok');
