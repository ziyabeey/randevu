import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { runTypeScriptShardBenchmark } from '../src/perf/typescript-shards.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-shard-persist-'));
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
      { path: './tsconfig.worker.json' }
    ]
  }));
  await writeFile(path.join(temp, 'tsconfig.app.json'), JSON.stringify({
    extends: './tsconfig.json',
    include: ['src']
  }));
  await writeFile(path.join(temp, 'tsconfig.worker.json'), JSON.stringify({
    extends: './tsconfig.json',
    include: ['worker']
  }));
  await writeFile(path.join(temp, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(path.join(temp, 'worker', 'b.ts'), 'export const b = 2;\n');
  await writeFile(path.join(temp, 'scripts', 'browser-booking-recovery.mjs'), 'export const x = 1;\n');

  for (const args of [
    ['init'],
    ['config','user.email','perf@example.invalid'],
    ['config','user.name','H19 Perf'],
    ['add','.'],
    ['commit','-m','fixture'],
  ]) {
    const r = spawnSync('git', args, { cwd: temp, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }

  const cacheRoot = path.join(temp, '.cross-run');
  let calls = 0;
  const execute = async (_command, args) => {
    calls += 1;
    const outputIndex = args.indexOf('--output') + 1;
    assert.ok(outputIndex > 0);
    await writeFile(args[outputIndex], Buffer.from(`fake-scip-${calls}`));
    return { code: 0, stdout: '', stderr: '' };
  };

  const first = await runTypeScriptShardBenchmark({
    cwd: temp,
    version: 'test',
    execute,
    persistentCacheRoot: cacheRoot,
  });
  assert.equal(first.measurements.crossRunCache.status, 'measured');
  assert.equal(first.measurements.crossRunCache.restoredArtifactsBefore, 0);
  assert.equal(first.measurements.crossRunCache.shardHits, 0);
  assert.equal(first.measurements.crossRunCache.shardMisses, 2);

  const second = await runTypeScriptShardBenchmark({
    cwd: temp,
    version: 'test',
    execute,
    persistentCacheRoot: cacheRoot,
  });
  assert.equal(second.measurements.crossRunCache.status, 'measured');
  assert.equal(second.measurements.crossRunCache.restoredArtifactsBefore, 2);
  assert.equal(second.measurements.crossRunCache.shardHits, 2);
  assert.equal(second.measurements.crossRunCache.shardMisses, 0);
  assert.deepEqual(second.measurements.irrelevantChange.affectedShards, []);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit cross-run shard cache smoke: ok');
