import { ArtifactCache } from '../core/artifact-cache.mjs';
import { projectFingerprint } from './project-fingerprint.mjs';
import { indexProject, scipTypeScriptIndexer } from './scip-launcher.mjs';
import { resolveTypeScriptProjectShards } from './typescript-project-shards.mjs';

const NAMESPACE = 'scip-project-v1';
const ARTIFACT = 'index.scip';

function exactVersion(value) {
  const version = String(value ?? '').trim();
  if (!version || version === 'auto' || version === 'unknown') {
    throw new TypeError('an exact configured SCIP TypeScript version is required for cache planning');
  }
  return version;
}

export async function planTypeScriptShardIndexes({
  cwd = process.cwd(),
  rootConfig = 'tsconfig.json',
  cache = new ArtifactCache(),
  scipVersion,
  scipCommand = 'scip-typescript',
  dependencySurfacesByShard = {},
} = {}) {
  const version = exactVersion(scipVersion);
  const shards = await resolveTypeScriptProjectShards({ cwd, rootConfig });
  const rows = [];

  for (const shard of shards) {
    const dependencySurfaces = dependencySurfacesByShard[shard.id] ?? {};
    const indexer = scipTypeScriptIndexer({
      version,
      command: scipCommand,
      flags: shard.flags,
    });
    const fingerprint = await projectFingerprint({
      cwd,
      projectRoot: shard.projectRoot,
      sourceFiles: shard.sourceFiles,
      configFiles: shard.configFiles,
      dependencySurfaces,
      indexer,
    });
    const hit = await cache.has(NAMESPACE, fingerprint.fingerprint, ARTIFACT);

    rows.push(Object.freeze({
      id: shard.id,
      configPath: shard.configPath,
      projectRoot: shard.projectRoot,
      sourceFiles: shard.sourceFiles,
      configFiles: shard.configFiles,
      flags: shard.flags,
      dependencySurfaces,
      fingerprint: fingerprint.fingerprint,
      cache: hit ? 'hit' : 'miss',
      indexFile: hit
        ? cache.fileFor(NAMESPACE, fingerprint.fingerprint, ARTIFACT)
        : null,
    }));
  }

  const hits = rows.filter((row) => row.cache === 'hit').length;
  const misses = rows.length - hits;

  return Object.freeze({
    schemaVersion: 1,
    kind: 'h19-typescript-shard-index-plan',
    indexer: Object.freeze({
      id: 'scip-typescript',
      version,
      command: scipCommand,
    }),
    shardCount: rows.length,
    hits,
    misses,
    allHit: rows.length > 0 && misses === 0,
    missingShardIds: Object.freeze(rows.filter((row) => row.cache === 'miss').map((row) => row.id)),
    rows: Object.freeze(rows),
  });
}

export async function materializeTypeScriptShardPlan({
  cwd = process.cwd(),
  plan,
  cache = new ArtifactCache(),
  execute,
  env = process.env,
} = {}) {
  if (!plan?.indexer?.version || !Array.isArray(plan?.rows)) {
    throw new TypeError('a TypeScript shard index plan is required');
  }

  const results = [];
  for (const row of plan.rows) {
    if (row.cache === 'hit') {
      results.push(Object.freeze({
        id: row.id,
        cache: 'hit',
        fingerprint: row.fingerprint,
        indexFile: row.indexFile,
        indexed: false,
      }));
      continue;
    }

    const indexer = scipTypeScriptIndexer({
      version: plan.indexer.version,
      command: plan.indexer.command,
      flags: row.flags,
    });
    const result = await indexProject({
      cwd,
      projectRoot: row.projectRoot,
      sourceFiles: row.sourceFiles,
      configFiles: row.configFiles,
      dependencySurfaces: row.dependencySurfaces,
      indexer,
      cache,
      ...(execute ? { execute } : {}),
      env,
    });

    if (result.fingerprint.fingerprint !== row.fingerprint) {
      throw new Error(`shard fingerprint changed between plan and execution: ${row.id}`);
    }
    if (result.cache !== 'miss') {
      throw new Error(`planned miss unexpectedly became cache hit during execution: ${row.id}`);
    }

    results.push(Object.freeze({
      id: row.id,
      cache: result.cache,
      fingerprint: result.fingerprint.fingerprint,
      indexFile: result.indexFile,
      indexed: true,
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'h19-typescript-shard-index-materialization',
    plannedMisses: plan.misses,
    indexed: results.filter((row) => row.indexed).length,
    reused: results.filter((row) => !row.indexed).length,
    results: Object.freeze(results),
  });
}
