import { stat } from 'node:fs/promises';
import path from 'node:path';

import { readScipJson } from '../adapters/scip.mjs';
import { ArtifactCache } from '../core/artifact-cache.mjs';
import { FileCache, cacheKey } from '../core/cache.mjs';
import { buildSymbolGraph } from '../graph/symbol-graph.mjs';
import { mergeScipIndexes } from '../graph/merge-scip-indexes.mjs';
import { fileSha256, normalizedScipGraph } from './graph-cache.mjs';
import { indexProject, scipTypeScriptIndexer } from './scip-launcher.mjs';
import { resolveTypeScriptProjectShards } from './typescript-project-shards.mjs';
import { sourceFiles } from '../repository/inventory.mjs';

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function wholeConfigFiles(cwd) {
  const candidates = [
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.worker.json',
    'tsconfig.node.json',
  ];
  const out = [];
  for (const file of candidates) {
    if (await exists(path.join(cwd, file))) out.push(file);
  }
  return out;
}

function defaultReader({ indexFile, cwd, scipExecutable }) {
  return readScipJson({ indexFile, cwd, executable: scipExecutable });
}

async function buildWholeGraph({
  cwd,
  scipTypeScriptVersion,
  scipTypeScriptCommand,
  scipExecutable,
  decoderIdentity,
  graphSchemaVersion,
  artifactCache,
  graphCache,
  executeIndexer,
  readIndex,
  fallbackReason = null,
}) {
  const allSources = (await sourceFiles(cwd))
    .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  const configs = await wholeConfigFiles(cwd);

  const indexed = await indexProject({
    cwd,
    projectRoot: '.',
    sourceFiles: allSources,
    configFiles: configs,
    dependencySurfaces: {},
    indexer: scipTypeScriptIndexer({
      version: scipTypeScriptVersion,
      command: scipTypeScriptCommand,
    }),
    cache: artifactCache,
    ...(executeIndexer ? { execute: executeIndexer } : {}),
  });

  const normalized = await normalizedScipGraph({
    indexFile: indexed.indexFile,
    converterVersion: decoderIdentity,
    graphSchemaVersion,
    cache: graphCache,
    readIndex: ({ indexFile }) => readIndex({
      indexFile,
      cwd,
      scipExecutable,
    }),
  });

  return Object.freeze({
    mode: fallbackReason ? 'whole-fallback' : 'whole',
    fallbackReason,
    graph: normalized.graph,
    graphCacheKey: normalized.indexSha256,
    provenance: Object.freeze({
      indexer: Object.freeze({
        id: 'scip-typescript',
        version: scipTypeScriptVersion,
      }),
      decoderIdentity,
      graphSchemaVersion,
    }),
    cache: Object.freeze({
      indexHits: indexed.cache === 'hit' ? 1 : 0,
      indexMisses: indexed.cache === 'miss' ? 1 : 0,
      graph: normalized.cache,
    }),
    shards: Object.freeze([{
      id: 'whole',
      sourceFiles: allSources.length,
      cache: indexed.cache,
      fingerprint: indexed.fingerprint.fingerprint,
      indexSha256: normalized.indexSha256,
    }]),
  });
}

export async function buildTypeScriptEvidenceGraph({
  cwd = process.cwd(),
  strategy = 'project-shards',
  allowWholeFallback = true,
  rootConfig = 'tsconfig.json',
  scipTypeScriptVersion,
  scipTypeScriptCommand = 'scip-typescript',
  scipExecutable = 'scip',
  decoderIdentity,
  graphSchemaVersion = 1,
  artifactCache = new ArtifactCache(),
  graphCache = new FileCache(),
  executeIndexer = null,
  readIndex = defaultReader,
} = {}) {
  if (!scipTypeScriptVersion) throw new TypeError('scipTypeScriptVersion is required');
  if (!decoderIdentity) throw new TypeError('decoderIdentity is required');
  if (!['project-shards', 'whole'].includes(strategy)) {
    throw new TypeError('strategy must be project-shards or whole');
  }

  const repoRoot = path.resolve(cwd);

  if (strategy === 'whole') {
    return buildWholeGraph({
      cwd: repoRoot,
      scipTypeScriptVersion,
      scipTypeScriptCommand,
      scipExecutable,
      decoderIdentity,
      graphSchemaVersion,
      artifactCache,
      graphCache,
      executeIndexer,
      readIndex,
    });
  }

  let shards;
  try {
    shards = await resolveTypeScriptProjectShards({
      cwd: repoRoot,
      rootConfig,
    });
    if (!shards.length) throw new Error('no TypeScript project shards resolved');
  } catch (error) {
    if (!allowWholeFallback) throw error;
    return buildWholeGraph({
      cwd: repoRoot,
      scipTypeScriptVersion,
      scipTypeScriptCommand,
      scipExecutable,
      decoderIdentity,
      graphSchemaVersion,
      artifactCache,
      graphCache,
      executeIndexer,
      readIndex,
      fallbackReason: error instanceof Error ? error.message : String(error),
    });
  }

  const indexedShards = [];
  for (const shard of shards) {
    const indexed = await indexProject({
      cwd: repoRoot,
      projectRoot: shard.projectRoot,
      sourceFiles: shard.sourceFiles,
      configFiles: shard.configFiles,
      dependencySurfaces: {},
      indexer: scipTypeScriptIndexer({
        version: scipTypeScriptVersion,
        command: scipTypeScriptCommand,
        flags: shard.flags,
      }),
      cache: artifactCache,
      ...(executeIndexer ? { execute: executeIndexer } : {}),
    });

    indexedShards.push({
      shard,
      indexed,
      indexSha256: await fileSha256(indexed.indexFile),
    });
  }

  const graphKeyInput = {
    schemaVersion: 1,
    decoderIdentity,
    graphSchemaVersion,
    shards: indexedShards
      .map(({ shard, indexed, indexSha256 }) => ({
        id: shard.id,
        fingerprint: indexed.fingerprint.fingerprint,
        indexSha256,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const graphKey = cacheKey('ts-project-graph-v1', graphKeyInput);
  const graphHit = await graphCache.get('ts-project-graph-v1', graphKey);

  let graph;
  let graphCacheState = 'hit';
  let documentCount = graphHit?.manifest?.documentCount ?? null;

  if (graphHit) {
    graph = graphHit.graph;
  } else {
    graphCacheState = 'miss';
    const raws = [];
    for (const { indexed } of indexedShards) {
      raws.push(await readIndex({
        indexFile: indexed.indexFile,
        cwd: repoRoot,
        scipExecutable,
      }));
    }

    const merged = mergeScipIndexes(raws);
    if (merged.conflicts.length) {
      throw new Error(`SCIP shard merge conflict: ${merged.conflicts[0].path}`);
    }

    graph = buildSymbolGraph(merged.index);
    documentCount = merged.index.documents.length;
    await graphCache.set('ts-project-graph-v1', graphKey, {
      manifest: {
        schemaVersion: 1,
        decoderIdentity,
        graphSchemaVersion,
        documentCount,
        nodeCount: graph.nodeCount,
        shardCount: shards.length,
      },
      graph,
    });
  }

  const shardRows = indexedShards.map(({ shard, indexed, indexSha256 }) => Object.freeze({
    id: shard.id,
    sourceFiles: shard.sourceFiles.length,
    cache: indexed.cache,
    fingerprint: indexed.fingerprint.fingerprint,
    indexSha256,
  }));

  return Object.freeze({
    mode: 'project-shards',
    fallbackReason: null,
    graph,
    graphCacheKey: graphKey,
    provenance: Object.freeze({
      indexer: Object.freeze({
        id: 'scip-typescript',
        version: scipTypeScriptVersion,
      }),
      decoderIdentity,
      graphSchemaVersion,
      rootConfig,
    }),
    cache: Object.freeze({
      indexHits: shardRows.filter((row) => row.cache === 'hit').length,
      indexMisses: shardRows.filter((row) => row.cache === 'miss').length,
      graph: graphCacheState,
    }),
    project: Object.freeze({
      shardCount: shards.length,
      declaredSourceFiles: new Set(shards.flatMap((shard) => shard.sourceFiles)).size,
      documentCount,
    }),
    shards: Object.freeze(shardRows),
  });
}
