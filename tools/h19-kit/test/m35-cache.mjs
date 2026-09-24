import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { indexProject, scipTypeScriptIndexer } from '../src/indexing/scip-launcher.mjs';
import { projectFingerprint } from '../src/indexing/project-fingerprint.mjs';
import { createHeadIndexManifest } from '../src/indexing/head-manifest.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-cache-smoke-'));
try {
  const project = path.join(temp, 'packages', 'payments');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'package.json'), '{"name":"payments"}\n');
  await writeFile(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}\n');
  await writeFile(path.join(project, 'src.ts'), 'export const amount = 1;\n');

  const cache = new ArtifactCache(path.join(temp, '.h19', 'artifacts'));
  const indexer = scipTypeScriptIndexer({ version: '0.3.0-test' });

  let executions = 0;
  const execute = async (_command, args) => {
    executions += 1;
    const outputIndex = args.indexOf('--output') + 1;
    assert.ok(outputIndex > 0);
    await writeFile(args[outputIndex], Buffer.from(`fake-scip-${executions}`));
    return { code: 0, stdout: '', stderr: '' };
  };

  const spec = {
    cwd: temp,
    projectRoot: 'packages/payments',
    sourceFiles: ['src.ts'],
    configFiles: ['package.json', 'tsconfig.json'],
    dependencySurfaces: { '../auth': 'surface-auth-v1' },
    indexer,
    cache,
    execute,
  };

  const first = await indexProject(spec);
  assert.equal(first.cache, 'miss');
  assert.equal(executions, 1);
  assert.equal((await readFile(first.indexFile)).toString(), 'fake-scip-1');

  const second = await indexProject(spec);
  assert.equal(second.cache, 'hit');
  assert.equal(executions, 1);
  assert.equal(second.fingerprint.fingerprint, first.fingerprint.fingerprint);

  // Unrelated repository content does not affect the project shard.
  await writeFile(path.join(temp, 'README.md'), 'new repository docs\n');
  const third = await indexProject(spec);
  assert.equal(third.cache, 'hit');
  assert.equal(executions, 1);

  // HEAD is provenance, not the content-addressed shard key.
  const manifestA = createHeadIndexManifest({
    repository: 'example/repo',
    head: 'a'.repeat(40),
    projects: [{
      projectRoot: spec.projectRoot,
      fingerprint: first.fingerprint.fingerprint,
      indexer: first.fingerprint.indexer,
    }],
  });
  const manifestB = createHeadIndexManifest({
    repository: 'example/repo',
    head: 'b'.repeat(40),
    projects: [{
      projectRoot: spec.projectRoot,
      fingerprint: first.fingerprint.fingerprint,
      indexer: first.fingerprint.indexer,
    }],
  });
  assert.notEqual(manifestA.manifestDigest, manifestB.manifestDigest);
  assert.equal(manifestA.projects[0].fingerprint, manifestB.projects[0].fingerprint);

  // Source content changes invalidate this shard.
  await writeFile(path.join(project, 'src.ts'), 'export const amount = 2;\n');
  const sourceChanged = await indexProject(spec);
  assert.equal(sourceChanged.cache, 'miss');
  assert.equal(executions, 2);
  assert.notEqual(sourceChanged.fingerprint.fingerprint, first.fingerprint.fingerprint);

  // Dependency public-surface changes invalidate downstream shard.
  const dependencyChanged = await indexProject({
    ...spec,
    dependencySurfaces: { '../auth': 'surface-auth-v2' },
  });
  assert.equal(dependencyChanged.cache, 'miss');
  assert.equal(executions, 3);

  // Indexer version is part of the cache key.
  const versionChanged = await indexProject({
    ...spec,
    dependencySurfaces: { '../auth': 'surface-auth-v2' },
    indexer: scipTypeScriptIndexer({ version: '0.4.0-test' }),
  });
  assert.equal(versionChanged.cache, 'miss');
  assert.equal(executions, 4);

  const fp = await projectFingerprint({
    cwd: temp,
    projectRoot: 'packages/payments',
    sourceFiles: ['src.ts'],
    configFiles: ['package.json', 'tsconfig.json'],
    dependencySurfaces: { '../auth': 'surface-auth-v2' },
    indexer: scipTypeScriptIndexer({ version: '0.4.0-test' }),
  });
  assert.equal(fp.fingerprint, versionChanged.fingerprint.fingerprint);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M3.5 SCIP cache smoke: ok');
