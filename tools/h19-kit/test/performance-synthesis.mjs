import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { FileCache } from '../src/core/cache.mjs';
import { pruneScipArtifactCache } from '../src/indexing/cache-prune.mjs';
import { buildTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-graph.mjs';
import { planTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-plan.mjs';
import {
  materializeTypeScriptShardPlan,
  planTypeScriptShardIndexes,
} from '../src/indexing/typescript-shard-plan.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-perf-synthesis-'));
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
  await writeFile(path.join(temp, 'src', 'a.ts'), 'export function a() { return 1 }\n');
  await writeFile(path.join(temp, 'worker', 'b.ts'), 'export function b() { return a() }\n');
  await writeFile(path.join(temp, 'scripts', 'ignored.mjs'), 'export const ignored = true;\n');

  const artifactRoot = path.join(temp, '.h19', 'artifacts');
  const graphRoot = path.join(temp, '.h19', 'cache');
  const artifactCache = new ArtifactCache(artifactRoot);
  const graphCache = new FileCache(graphRoot);

  const coldPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache: artifactCache,
    scipVersion: '0.4.0-test',
    scipCommand: 'fake-scip-typescript',
  });
  assert.equal(coldPlan.shardCount, 2);
  assert.equal(coldPlan.hits, 0);
  assert.equal(coldPlan.misses, 2);

  let indexerCalls = 0;
  const execute = async (_command, args) => {
    indexerCalls += 1;
    const output = args[args.indexOf('--output') + 1];
    const project = args.find((arg) => /^tsconfig(?:\.[\w-]+)?\.json$/i.test(arg)) ?? 'whole';
    await writeFile(output, Buffer.from(`${project}:${indexerCalls}`));
    return { code: 0, stdout: '', stderr: '' };
  };

  const seeded = await materializeTypeScriptShardPlan({
    cwd: temp,
    plan: coldPlan,
    cache: artifactCache,
    execute,
  });
  assert.equal(seeded.indexed, 2);
  assert.equal(indexerCalls, 2);

  const warmPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache: artifactCache,
    scipVersion: '0.4.0-test',
    scipCommand: 'binary-not-installed',
  });
  assert.equal(warmPlan.hits, 2);
  assert.equal(warmPlan.misses, 0);

  const beforeGraphPlan = await planTypeScriptEvidenceGraph({
    cwd: temp,
    artifactCache,
    graphCache,
    scipVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
  });
  assert.equal(beforeGraphPlan.index.misses, 0);
  assert.equal(beforeGraphPlan.graph.state, 'miss');
  assert.equal(beforeGraphPlan.needsIndexer, false);
  assert.equal(beforeGraphPlan.needsDecoder, true);
  assert.equal(beforeGraphPlan.ready, false);

  let decoderReads = 0;
  const readIndex = async ({ indexFile }) => {
    decoderReads += 1;
    const { readFile } = await import('node:fs/promises');
    const marker = await readFile(indexFile, 'utf8');
    const project = marker.split(':')[0];
    if (project === 'tsconfig.app.json') {
      return {
        documents: [{
          relative_path: 'src/a.ts',
          language: 'typescript',
          occurrences: [{
            symbol: 'demo/a().',
            symbol_roles: 1,
            range: [0, 0, 1],
          }],
          symbols: [{
            symbol: 'demo/a().',
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
            symbol: 'demo/a().',
            symbol_roles: 8,
            range: [0, 30, 31],
          }],
          symbols: [],
        }],
      };
    }
    throw new Error(`unexpected project: ${project}`);
  };

  const noExecute = async () => {
    throw new Error('indexer must not run on an all-hit plan');
  };

  const coldGraph = await buildTypeScriptEvidenceGraph({
    cwd: temp,
    scipTypeScriptVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
    artifactCache,
    graphCache,
    executeIndexer: noExecute,
    readIndex,
  });
  assert.equal(coldGraph.cache.indexHits, 2);
  assert.equal(coldGraph.cache.indexMisses, 0);
  assert.equal(coldGraph.cache.graph, 'miss');
  assert.equal(coldGraph.graph.nodeCount, 1);
  assert.equal(decoderReads, 2);

  const warmGraph = await buildTypeScriptEvidenceGraph({
    cwd: temp,
    scipTypeScriptVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
    artifactCache,
    graphCache,
    executeIndexer: noExecute,
    readIndex,
  });
  assert.equal(warmGraph.cache.graph, 'hit');
  assert.equal(warmGraph.graphCacheKey, coldGraph.graphCacheKey);
  assert.equal(decoderReads, 2);

  const allHitPlan = await planTypeScriptEvidenceGraph({
    cwd: temp,
    artifactCache,
    graphCache,
    scipVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
  });
  assert.equal(allHitPlan.index.misses, 0);
  assert.equal(allHitPlan.graph.state, 'hit');
  assert.equal(allHitPlan.needsIndexer, false);
  assert.equal(allHitPlan.needsDecoder, false);
  assert.equal(allHitPlan.ready, true);

  await writeFile(path.join(temp, 'scripts', 'ignored.mjs'), 'export const ignored = false;\n');
  const irrelevantPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache: artifactCache,
    scipVersion: '0.4.0-test',
  });
  assert.equal(irrelevantPlan.misses, 0);

  const irrelevantGraph = await buildTypeScriptEvidenceGraph({
    cwd: temp,
    scipTypeScriptVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
    artifactCache,
    graphCache,
    executeIndexer: noExecute,
    readIndex,
  });
  assert.equal(irrelevantGraph.cache.graph, 'hit');
  assert.equal(irrelevantGraph.graphCacheKey, coldGraph.graphCacheKey);

  await writeFile(path.join(temp, 'src', 'a.ts'), 'export function a() { return 2 }\n');
  const changedPlan = await planTypeScriptShardIndexes({
    cwd: temp,
    cache: artifactCache,
    scipVersion: '0.4.0-test',
    scipCommand: 'fake-scip-typescript',
  });
  assert.deepEqual(changedPlan.missingShardIds, ['tsconfig.app.json']);
  assert.equal(changedPlan.hits, 1);
  assert.equal(changedPlan.misses, 1);

  const changedEvidencePlan = await planTypeScriptEvidenceGraph({
    cwd: temp,
    artifactCache,
    graphCache,
    scipVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
  });
  assert.equal(changedEvidencePlan.graph.state, 'blocked-on-index-misses');
  assert.equal(changedEvidencePlan.needsIndexer, true);
  assert.equal(changedEvidencePlan.needsDecoder, true);
  assert.equal(changedEvidencePlan.ready, false);

  const changedMaterialization = await materializeTypeScriptShardPlan({
    cwd: temp,
    plan: changedPlan,
    cache: artifactCache,
    execute,
  });
  assert.equal(changedMaterialization.indexed, 1);
  assert.equal(changedMaterialization.reused, 1);
  assert.equal(indexerCalls, 3);

  const changedGraph = await buildTypeScriptEvidenceGraph({
    cwd: temp,
    scipTypeScriptVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
    artifactCache,
    graphCache,
    executeIndexer: noExecute,
    readIndex,
  });
  assert.equal(changedGraph.cache.indexHits, 2);
  assert.equal(changedGraph.cache.graph, 'miss');
  assert.notEqual(changedGraph.graphCacheKey, coldGraph.graphCacheKey);

  const finalPlan = await planTypeScriptEvidenceGraph({
    cwd: temp,
    artifactCache,
    graphCache,
    scipVersion: '0.4.0-test',
    decoderIdentity: 'decoder-test-v1',
  });
  assert.equal(finalPlan.index.misses, 0);
  assert.equal(finalPlan.graph.state, 'hit');
  assert.equal(finalPlan.ready, true);

  const pruned = await pruneScipArtifactCache({
    root: artifactRoot,
    keepPerShard: 1,
    maxBytes: 16 * 1024 * 1024,
  });
  assert.equal(pruned.logicalShards, 2);
  assert.equal(pruned.afterEntries, 2);
  assert.ok(pruned.removedEntries >= 1);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit performance production synthesis smoke: ok');
