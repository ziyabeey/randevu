import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { FileCache } from '../src/core/cache.mjs';
import { buildTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-graph.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-ts-evidence-'));
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

  const artifactCache = new ArtifactCache(path.join(temp, '.cache', 'artifacts'));
  const graphCache = new FileCache(path.join(temp, '.cache', 'graphs'));
  let executions = 0;
  let reads = 0;

  const executeIndexer = async (_command, args) => {
    executions += 1;
    const outIndex = args.indexOf('--output') + 1;
    const projectIndex = args.indexOf('-p');
    const bareConfig = args.find((arg) => /^tsconfig(?:\.[\w-]+)?\.json$/i.test(arg));
    const project = projectIndex >= 0 ? args[projectIndex + 1] : (bareConfig ?? 'whole');
    await writeFile(args[outIndex], `${project}:${executions}`);
    return { code: 0, stdout: '', stderr: '' };
  };

  const readIndex = async ({ indexFile }) => {
    reads += 1;
    const marker = await readFile(indexFile, 'utf8');
    const project = marker.split(':')[0];
    if (project === 'tsconfig.app.json') {
      return {
        documents: [{
          relative_path: 'src/a.ts',
          language: 'typescript',
          occurrences: [{
            symbol: 'demo/a#',
            symbol_roles: 1,
            range: [0, 0, 1],
          }],
          symbols: [{
            symbol: 'demo/a#',
            display_name: 'a',
            kind: 17,
            relationships: [],
          }],
        }],
      };
    }
    if (project === 'tsconfig.worker.json') {
      return {
        documents: [{
          relative_path: 'worker/b.ts',
          language: 'typescript',
          occurrences: [{
            symbol: 'demo/a#',
            symbol_roles: 8,
            range: [0, 0, 1],
          }],
          symbols: [],
        }],
      };
    }
    throw new Error(`unexpected project marker: ${project}`);
  };

  const params = {
    cwd: temp,
    scipTypeScriptVersion: '0.4.0-test',
    decoderIdentity: 'scip-test',
    artifactCache,
    graphCache,
    executeIndexer,
    readIndex,
  };

  const cold = await buildTypeScriptEvidenceGraph(params);
  assert.equal(cold.mode, 'project-shards');
  assert.equal(cold.cache.indexHits, 0);
  assert.equal(cold.cache.indexMisses, 2);
  assert.equal(cold.cache.graph, 'miss');
  assert.equal(cold.project.documentCount, 2);
  assert.equal(cold.graph.nodeCount, 1);
  assert.equal(executions, 2);
  assert.equal(reads, 2);

  const warm = await buildTypeScriptEvidenceGraph(params);
  assert.equal(warm.cache.indexHits, 2);
  assert.equal(warm.cache.indexMisses, 0);
  assert.equal(warm.cache.graph, 'hit');
  assert.equal(warm.graphCacheKey, cold.graphCacheKey);
  assert.equal(executions, 2);
  assert.equal(reads, 2);

  await writeFile(path.join(temp, 'src', 'a.ts'), 'export const a = 2;\n');
  const changed = await buildTypeScriptEvidenceGraph(params);
  assert.equal(changed.cache.indexHits, 1);
  assert.equal(changed.cache.indexMisses, 1);
  assert.equal(changed.cache.graph, 'miss');
  assert.notEqual(changed.graphCacheKey, cold.graphCacheKey);
  assert.equal(executions, 3);
  assert.equal(reads, 4);

  await writeFile(path.join(temp, 'src', 'a.ts'), 'export const a = 1;\n');
  const restored = await buildTypeScriptEvidenceGraph(params);
  assert.equal(restored.cache.indexHits, 2);
  assert.equal(restored.cache.indexMisses, 0);
  assert.equal(restored.cache.graph, 'hit');
  assert.equal(restored.graphCacheKey, cold.graphCacheKey);

  await writeFile(path.join(temp, 'scripts', 'ignored.mjs'), 'export const ignored = false;\n');
  const irrelevant = await buildTypeScriptEvidenceGraph(params);
  assert.equal(irrelevant.cache.indexHits, 2);
  assert.equal(irrelevant.cache.indexMisses, 0);
  assert.equal(irrelevant.cache.graph, 'hit');
  assert.equal(irrelevant.graphCacheKey, cold.graphCacheKey);
  assert.equal(executions, 3);
  assert.equal(reads, 4);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit TypeScript evidence-graph adoption smoke: ok');
