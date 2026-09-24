import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverTypeScriptProjectShards } from '../src/indexing/typescript-projects.mjs';
import { projectFingerprint } from '../src/indexing/project-fingerprint.mjs';
import { scipTypeScriptIndexer } from '../src/indexing/scip-launcher.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-perf-shards-'));
try {
  await mkdir(path.join(temp, 'src'), { recursive: true });
  await mkdir(path.join(temp, 'worker'), { recursive: true });
  await mkdir(path.join(temp, 'scripts'), { recursive: true });

  await writeFile(path.join(temp, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(path.join(temp, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify({
    files: [],
    references: [
      { path: './tsconfig.app.json' },
      { path: './tsconfig.worker.json' },
    ],
  }));
  await writeFile(path.join(temp, 'tsconfig.app.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022' },
    include: ['src'],
  }));
  await writeFile(path.join(temp, 'tsconfig.worker.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022' },
    include: ['worker'],
  }));
  await writeFile(path.join(temp, 'src', 'app.ts'), 'export const app = 1;\n');
  await writeFile(path.join(temp, 'worker', 'job.ts'), 'export const job = 1;\n');
  await writeFile(path.join(temp, 'scripts', 'tool.mjs'), 'export const tool = 1;\n');

  const discovered = discoverTypeScriptProjectShards({ cwd: temp });
  assert.equal(discovered.shards.length, 2);
  assert.deepEqual(discovered.indexedFiles, ['src/app.ts', 'worker/job.ts']);
  assert.ok(!discovered.indexedFiles.includes('scripts/tool.mjs'));

  const app = discovered.shards.find((x) => x.configPath === 'tsconfig.app.json');
  assert.ok(app);
  assert.deepEqual(app.sourceFiles, ['src/app.ts']);

  const indexer = scipTypeScriptIndexer({
    version: '0.4.0-test',
    projects: [app.configPath],
  });
  assert.deepEqual(
    indexer.buildArgs({ output: '/tmp/index.scip' }),
    ['index', '--output', '/tmp/index.scip', 'tsconfig.app.json'],
  );

  const fpArgs = {
    cwd: temp,
    projectRoot: '.',
    sourceFiles: app.sourceFiles,
    configFiles: ['package.json', 'package-lock.json', ...app.configFiles],
    dependencySurfaces: {},
    indexer,
  };
  const before = await projectFingerprint(fpArgs);

  await writeFile(path.join(temp, 'scripts', 'tool.mjs'), 'export const tool = 2;\n');
  const unrelated = await projectFingerprint(fpArgs);
  assert.equal(unrelated.fingerprint, before.fingerprint);

  await writeFile(path.join(temp, 'src', 'app.ts'), 'export const app = 2;\n');
  const changed = await projectFingerprint(fpArgs);
  assert.notEqual(changed.fingerprint, before.fingerprint);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit TypeScript shard fingerprint smoke: ok');
