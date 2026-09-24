import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveTypeScriptProjectShards,
  shardForChangedFile,
} from '../src/indexing/typescript-project-shards.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-ts-shards-'));
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

  const shards = await resolveTypeScriptProjectShards({ cwd: temp });
  assert.equal(shards.length, 2);

  const app = shards.find((x) => x.id === 'tsconfig.app.json');
  const worker = shards.find((x) => x.id === 'tsconfig.worker.json');
  assert.deepEqual(app.sourceFiles, ['src/a.ts']);
  assert.deepEqual(worker.sourceFiles, ['worker/b.ts']);
  assert.ok(app.configFiles.includes('tsconfig.json'));
  assert.ok(app.configFiles.includes('tsconfig.app.json'));
  assert.ok(app.configFiles.includes('package-lock.json'));
  assert.deepEqual(app.flags, ['tsconfig.app.json']);
  assert.deepEqual(worker.flags, ['tsconfig.worker.json']);

  assert.deepEqual(shardForChangedFile(shards, 'src/a.ts'), ['tsconfig.app.json']);
  assert.deepEqual(shardForChangedFile(shards, 'worker/b.ts'), ['tsconfig.worker.json']);
  assert.deepEqual(shardForChangedFile(shards, 'scripts/ignored.mjs'), []);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit TypeScript project-shard resolver smoke: ok');
