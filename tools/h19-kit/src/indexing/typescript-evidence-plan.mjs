import { ArtifactCache } from '../core/artifact-cache.mjs';
import { FileCache } from '../core/cache.mjs';
import { fileSha256 } from './graph-cache.mjs';
import { planTypeScriptShardIndexes } from './typescript-shard-plan.mjs';
import { typeScriptProjectGraphKey } from './typescript-graph-key.mjs';

export async function planTypeScriptEvidenceGraph({
  cwd = process.cwd(),
  rootConfig = 'tsconfig.json',
  artifactCache = new ArtifactCache(),
  graphCache = new FileCache(),
  scipVersion,
  scipCommand = 'scip-typescript',
  decoderIdentity,
  graphSchemaVersion = 1,
  dependencySurfacesByShard = {},
} = {}) {
  if (!decoderIdentity) throw new TypeError('decoderIdentity is required');

  const indexPlan = await planTypeScriptShardIndexes({
    cwd,
    rootConfig,
    cache: artifactCache,
    scipVersion,
    scipCommand,
    dependencySurfacesByShard,
  });

  if (indexPlan.misses > 0) {
    return Object.freeze({
      schemaVersion: 1,
      kind: 'h19-typescript-evidence-plan',
      index: indexPlan,
      graph: Object.freeze({
        state: 'blocked-on-index-misses',
        key: null,
      }),
      needsIndexer: true,
      needsDecoder: true,
      ready: false,
    });
  }

  const rows = [];
  for (const row of indexPlan.rows) {
    rows.push({
      id: row.id,
      fingerprint: row.fingerprint,
      indexSha256: await fileSha256(row.indexFile),
    });
  }

  const graphKey = typeScriptProjectGraphKey({
    decoderIdentity,
    graphSchemaVersion,
    shards: rows,
  });
  const hit = await graphCache.get('ts-project-graph-v1', graphKey.key);

  return Object.freeze({
    schemaVersion: 1,
    kind: 'h19-typescript-evidence-plan',
    index: indexPlan,
    graph: Object.freeze({
      state: hit ? 'hit' : 'miss',
      key: graphKey.key,
    }),
    needsIndexer: false,
    needsDecoder: !hit,
    ready: Boolean(hit),
  });
}
