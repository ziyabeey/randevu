import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ArtifactCache } from '../core/artifact-cache.mjs';
import { indexProject, scipTypeScriptIndexer } from '../indexing/scip-launcher.mjs';
import { resolveTypeScriptProjectShards } from '../indexing/typescript-project-shards.mjs';

function round(value, digits = 3) {
  const n = 10 ** digits;
  return Math.round(value * n) / n;
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return {
    value,
    wallMs: round(performance.now() - start),
  };
}

export async function runPersistentShardCacheProbe({
  cwd = process.cwd(),
  cacheRoot = '.h19/perf-shard-artifacts',
  scipVersion = '0.4.0',
} = {}) {
  const repoRoot = path.resolve(cwd);
  const cache = new ArtifactCache(path.resolve(repoRoot, cacheRoot));
  const shards = await resolveTypeScriptProjectShards({ cwd: repoRoot });

  const rows = [];
  const total = await timed(async () => {
    for (const shard of shards) {
      const row = await timed(() => indexProject({
        cwd: repoRoot,
        projectRoot: shard.projectRoot,
        sourceFiles: shard.sourceFiles,
        configFiles: shard.configFiles,
        dependencySurfaces: {},
        indexer: scipTypeScriptIndexer({
          version: scipVersion,
          command: 'scip-typescript',
          flags: shard.flags,
        }),
        cache,
      }));

      rows.push({
        id: shard.id,
        sourceFiles: shard.sourceFiles.length,
        cache: row.value.cache,
        wallMs: row.wallMs,
        fingerprint: row.value.fingerprint.fingerprint,
      });
    }
  });

  const hits = rows.filter((x) => x.cache === 'hit').length;
  const misses = rows.filter((x) => x.cache === 'miss').length;

  return {
    schemaVersion: 1,
    kind: 'h19-persistent-shard-cache-probe',
    generatedAt: new Date().toISOString(),
    cacheRoot,
    indexer: {
      id: 'scip-typescript',
      version: scipVersion,
    },
    shardCount: rows.length,
    hits,
    misses,
    totalMs: total.wallMs,
    rows,
    interpretation: {
      allHit: rows.length > 0 && hits === rows.length,
      allMiss: rows.length > 0 && misses === rows.length,
      note: 'This probe measures whether content-addressed shard artifacts survived into this workflow run. It does not infer why a cache restore hit or missed.',
    },
  };
}
