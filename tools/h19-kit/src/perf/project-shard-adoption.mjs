import { appendFile, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { ArtifactCache } from '../core/artifact-cache.mjs';
import { FileCache } from '../core/cache.mjs';
import { buildTypeScriptEvidenceGraph } from '../indexing/typescript-evidence-graph.mjs';
import { resolveTypeScriptProjectShards } from '../indexing/typescript-project-shards.mjs';

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

async function cloneRepo(source, target) {
  const clone = spawnSync('git', ['clone', '--shared', '--quiet', source, target], {
    encoding: 'utf8',
  });
  if (clone.status !== 0) {
    throw new Error(`local clone failed: ${String(clone.stderr || clone.stdout).trim()}`);
  }
  try {
    await stat(path.join(source, 'node_modules'));
    await symlink(path.join(source, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export async function runProjectShardAdoptionBenchmark({
  cwd = process.cwd(),
  scipExecutable = 'scip',
  scipTypeScriptVersion = '0.4.0',
  decoderIdentity,
} = {}) {
  if (!decoderIdentity) throw new TypeError('decoderIdentity required');

  const repoRoot = path.resolve(cwd);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-adoption-perf-'));
  const artifactCache = new ArtifactCache(path.join(temp, 'artifacts'));
  const graphCache = new FileCache(path.join(temp, 'graphs'));

  const params = {
    scipTypeScriptVersion,
    scipExecutable,
    decoderIdentity,
    artifactCache,
    graphCache,
  };

  try {
    const cold = await timed(() => buildTypeScriptEvidenceGraph({
      cwd: repoRoot,
      ...params,
    }));
    const warm = await timed(() => buildTypeScriptEvidenceGraph({
      cwd: repoRoot,
      ...params,
    }));

    const shards = await resolveTypeScriptProjectShards({ cwd: repoRoot });
    const mutation = [...shards]
      .sort((a, b) => b.sourceFiles.length - a.sourceFiles.length || a.id.localeCompare(b.id))
      .flatMap((shard) => shard.sourceFiles.map((file) => ({ shard, file })))
      .find(({ file }) => !/\.d\.ts$/i.test(file));
    if (!mutation) throw new Error('no mutable project source found');

    const mutationRoot = path.join(temp, 'project-mutation');
    await cloneRepo(repoRoot, mutationRoot);
    await appendFile(
      path.join(mutationRoot, mutation.file),
      '\n// h19-production-shard-adoption-change\n',
    );
    const changed = await timed(() => buildTypeScriptEvidenceGraph({
      cwd: mutationRoot,
      ...params,
    }));

    const irrelevantRoot = path.join(temp, 'irrelevant-mutation');
    await cloneRepo(repoRoot, irrelevantRoot);
    const irrelevantPath = 'scripts/browser-booking-recovery.mjs';
    await appendFile(
      path.join(irrelevantRoot, irrelevantPath),
      '\n// h19-production-shard-adoption-irrelevant\n',
    );
    const irrelevant = await timed(() => buildTypeScriptEvidenceGraph({
      cwd: irrelevantRoot,
      ...params,
    }));

    const pass = cold.value.mode === 'project-shards'
      && cold.value.cache.indexMisses === cold.value.project.shardCount
      && cold.value.cache.graph === 'miss'
      && warm.value.cache.indexHits === warm.value.project.shardCount
      && warm.value.cache.indexMisses === 0
      && warm.value.cache.graph === 'hit'
      && changed.value.cache.indexMisses === 1
      && changed.value.cache.indexHits === changed.value.project.shardCount - 1
      && changed.value.cache.graph === 'miss'
      && irrelevant.value.cache.indexMisses === 0
      && irrelevant.value.cache.indexHits === irrelevant.value.project.shardCount
      && irrelevant.value.cache.graph === 'hit'
      && irrelevant.value.graphCacheKey === cold.value.graphCacheKey;

    return {
      schemaVersion: 1,
      kind: 'h19-project-shard-adoption',
      generatedAt: new Date().toISOString(),
      decoderIdentity,
      indexerVersion: scipTypeScriptVersion,
      cold: {
        wallMs: cold.wallMs,
        mode: cold.value.mode,
        shardCount: cold.value.project.shardCount,
        documentCount: cold.value.project.documentCount,
        cache: cold.value.cache,
      },
      warm: {
        wallMs: warm.wallMs,
        cache: warm.value.cache,
        sameGraphKey: warm.value.graphCacheKey === cold.value.graphCacheKey,
      },
      projectSourceChange: {
        path: mutation.file,
        ownerShard: mutation.shard.id,
        wallMs: changed.wallMs,
        cache: changed.value.cache,
        graphKeyChanged: changed.value.graphCacheKey !== cold.value.graphCacheKey,
      },
      outOfProjectChange: {
        path: irrelevantPath,
        wallMs: irrelevant.wallMs,
        cache: irrelevant.value.cache,
        sameGraphKey: irrelevant.value.graphCacheKey === cold.value.graphCacheKey,
      },
      pass,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
