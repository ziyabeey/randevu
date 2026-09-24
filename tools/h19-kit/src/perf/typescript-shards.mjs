import { appendFile, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
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
} = {}) {
  const repoRoot = path.resolve(cwd);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-ts-shard-perf-'));

  try {
    const shards = await resolveTypeScriptProjectShards({ cwd: repoRoot });
    if (!shards.length) throw new Error('no TypeScript project shards resolved');

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
        reindexMs: mutationTotal.wallMs,
        shards: mutationRows,
        unaffected: unaffectedChecks,
      };
    }

    const irrelevantFile = 'scripts/browser-booking-recovery.mjs';
    const irrelevantStarted = performance.now();
    const irrelevantAffected = shardForChangedFile(shards, irrelevantFile);
    const irrelevantDecisionMs = round(performance.now() - irrelevantStarted);

    return {
      schemaVersion: 1,
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
