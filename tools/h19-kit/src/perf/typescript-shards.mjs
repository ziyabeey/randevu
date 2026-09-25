import { appendFile, mkdtemp, readdir, rm, stat, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ArtifactCache } from '../core/artifact-cache.mjs';
import { indexProject, scipTypeScriptIndexer } from '../indexing/scip-launcher.mjs';
import {
  resolveTypeScriptProjectShards,
  shardForChangedFile,
} from '../indexing/typescript-project-shards.mjs';

function round(value, digits = 3) {
  const n = 10 ** digits;
  return Math.round(value * n) / n;
}

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return {
    value,
    wallMs: round(performance.now() - started),
  };
}

async function countCachedIndexes(root) {
  let count = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name === 'index.scip') count += 1;
    }
  }
  await walk(root);
  return count;
}

async function indexShard({
  cwd,
  shard,
  cache,
  version,
  execute,
}) {
  return indexProject({
    cwd,
    projectRoot: shard.projectRoot,
    sourceFiles: shard.sourceFiles,
    configFiles: shard.configFiles,
    dependencySurfaces: {},
    indexer: scipTypeScriptIndexer({
      version,
      command: 'scip-typescript',
      flags: shard.flags,
    }),
    cache,
    ...(execute ? { execute } : {}),
  });
}

function candidateMutation(shards) {
  return [...shards]
    .sort((a, b) => b.sourceFiles.length - a.sourceFiles.length || a.id.localeCompare(b.id))
    .flatMap((shard) => shard.sourceFiles.map((file) => ({ shard, file })))
    .find(({ file }) => !/\.d\.ts$/i.test(file)) ?? null;
}

export async function runTypeScriptShardBenchmark({
  cwd = process.cwd(),
  version = '0.4.0',
  execute = null,
  persistentCacheRoot = null,
} = {}) {
  const repoRoot = path.resolve(cwd);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-ts-shard-perf-'));

  try {
    const shards = await resolveTypeScriptProjectShards({ cwd: repoRoot });
    if (!shards.length) throw new Error('no TypeScript project shards resolved');

    let crossRunCache = {
      status: 'not-configured',
      restoredArtifactsBefore: 0,
      shardHits: 0,
      shardMisses: 0,
      totalMs: null,
      rows: [],
    };

    if (persistentCacheRoot) {
      const persistentArtifactsRoot = path.join(path.resolve(persistentCacheRoot), 'artifacts');
      const restoredArtifactsBefore = await countCachedIndexes(persistentArtifactsRoot);
      const persistentCache = new ArtifactCache(persistentArtifactsRoot);
      const rows = [];
      const persistentTotal = await timed(async () => {
        for (const shard of shards) {
          const row = await timed(() => indexShard({
            cwd: repoRoot,
            shard,
            cache: persistentCache,
            version,
            execute,
          }));
          rows.push({
            id: shard.id,
            cache: row.value.cache,
            wallMs: row.wallMs,
          });
        }
      });
      crossRunCache = {
        status: 'measured',
        restoredArtifactsBefore,
        shardHits: rows.filter((x) => x.cache === 'hit').length,
        shardMisses: rows.filter((x) => x.cache === 'miss').length,
        totalMs: persistentTotal.wallMs,
        rows,
      };
    }

    const cache = new ArtifactCache(path.join(temp, 'artifacts'));
    const coldRows = [];

    const coldTotal = await timed(async () => {
      for (const shard of shards) {
        const row = await timed(() => indexShard({
          cwd: repoRoot,
          shard,
          cache,
          version,
          execute,
        }));
        if (row.value.cache !== 'miss') throw new Error(`cold shard unexpectedly hit: ${shard.id}`);
        const info = await stat(row.value.indexFile);
        coldRows.push({
          id: shard.id,
          sourceFiles: shard.sourceFiles.length,
          coldMs: row.wallMs,
          indexBytes: info.size,
        });
      }
    });

    const warmRows = [];
    const warmTotal = await timed(async () => {
      for (const shard of shards) {
        const row = await timed(() => indexShard({
          cwd: repoRoot,
          shard,
          cache,
          version,
          execute,
        }));
        if (row.value.cache !== 'hit') throw new Error(`warm shard unexpectedly missed: ${shard.id}`);
        warmRows.push({
          id: shard.id,
          warmHitMs: row.wallMs,
        });
      }
    });

    const mutation = candidateMutation(shards);
    let singleFileChange = {
      status: 'not-measured',
      reason: 'no mutable project source found',
    };

    if (mutation) {
      const mutationRoot = path.join(temp, 'mutation-repo');
      const clone = spawnSync('git', ['clone', '--shared', '--quiet', repoRoot, mutationRoot], {
        cwd: temp,
        encoding: 'utf8',
      });
      if (clone.status !== 0) {
        throw new Error(`local mutation clone failed: ${String(clone.stderr || clone.stdout).trim()}`);
      }

      try {
        await stat(path.join(repoRoot, 'node_modules'));
        await symlink(path.join(repoRoot, 'node_modules'), path.join(mutationRoot, 'node_modules'), 'dir');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }

      await appendFile(
        path.join(mutationRoot, mutation.file),
        '\n// h19-tsconfig-shard-single-file-change\n',
      );

      const changedShards = await resolveTypeScriptProjectShards({ cwd: mutationRoot });
      const affectedIds = shardForChangedFile(changedShards, mutation.file);
      const affected = changedShards.filter((shard) => affectedIds.includes(shard.id));

      const fullRootSources = [...new Set(changedShards.flatMap((shard) => shard.sourceFiles))].sort();
      const fullRootConfigs = [...new Set(changedShards.flatMap((shard) => shard.configFiles))].sort();
      const fullRootControl = await timed(() => indexProject({
        cwd: mutationRoot,
        projectRoot: '.',
        sourceFiles: fullRootSources,
        configFiles: fullRootConfigs,
        dependencySurfaces: {},
        indexer: scipTypeScriptIndexer({
          version,
          command: 'scip-typescript',
          flags: [],
        }),
        cache: new ArtifactCache(path.join(temp, 'full-root-mutation-artifacts')),
        ...(execute ? { execute } : {}),
      }));
      if (fullRootControl.value.cache !== 'miss') {
        throw new Error('full-root same-file control unexpectedly hit cache');
      }

      const mutationRows = [];
      const mutationTotal = await timed(async () => {
        for (const shard of affected) {
          const row = await timed(() => indexShard({
            cwd: mutationRoot,
            shard,
            cache,
            version,
            execute,
          }));
          if (row.value.cache !== 'miss') {
            throw new Error(`changed shard unexpectedly hit: ${shard.id}`);
          }
          mutationRows.push({
            id: shard.id,
            reindexMs: row.wallMs,
          });
        }
      });

      const unaffected = changedShards.filter((shard) => !affectedIds.includes(shard.id));
      const unaffectedChecks = [];
      for (const shard of unaffected) {
        const row = await timed(() => indexShard({
          cwd: mutationRoot,
          shard,
          cache,
          version,
          execute,
        }));
        unaffectedChecks.push({
          id: shard.id,
          cache: row.value.cache,
          lookupMs: row.wallMs,
        });
        if (row.value.cache !== 'hit') {
          throw new Error(`unchanged shard invalidated: ${shard.id}`);
        }
      }

      singleFileChange = {
        status: 'measured',
        path: mutation.file,
        ownerShard: mutation.shard.id,
        affectedShards: affectedIds,
        affectedShardCount: affectedIds.length,
        fullRootReindexMs: fullRootControl.wallMs,
        shardReindexMs: mutationTotal.wallMs,
        speedup: mutationTotal.wallMs > 0
          ? round(fullRootControl.wallMs / mutationTotal.wallMs, 2)
          : null,
        reductionPct: fullRootControl.wallMs > 0
          ? round((1 - (mutationTotal.wallMs / fullRootControl.wallMs)) * 100, 1)
          : null,
        shards: mutationRows,
        unaffected: unaffectedChecks,
      };
    }

    const irrelevantFile = 'scripts/browser-booking-recovery.mjs';
    const irrelevantStarted = performance.now();
    const irrelevantAffected = shardForChangedFile(shards, irrelevantFile);
    const irrelevantDecisionMs = round(performance.now() - irrelevantStarted);

    return {
      schemaVersion: 2,
      kind: 'h19-typescript-shard-performance',
      generatedAt: new Date().toISOString(),
      repository: repoRoot,
      indexer: {
        id: 'scip-typescript',
        version,
      },
      shards: shards.map((shard) => ({
        id: shard.id,
        sourceFiles: shard.sourceFiles.length,
        configFiles: shard.configFiles,
      })),
      measurements: {
        crossRunCache,
        coldSequentialMs: coldTotal.wallMs,
        cold: coldRows,
        exactWarmSequentialMs: warmTotal.wallMs,
        warm: warmRows,
        singleFileChange,
        irrelevantChange: {
          path: irrelevantFile,
          affectedShards: irrelevantAffected,
          decisionMs: irrelevantDecisionMs,
        },
      },
      interpretation: {
        expectedInvariant: 'Only shards whose declared TypeScript project inputs changed may be reindexed.',
      },
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
