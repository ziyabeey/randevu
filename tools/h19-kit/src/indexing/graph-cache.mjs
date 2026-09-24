import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FileCache, cacheKey } from '../core/cache.mjs';
import { readScipJson } from '../adapters/scip.mjs';
import { buildSymbolGraph } from '../graph/symbol-graph.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');

export async function fileSha256(file) {
  return sha(await readFile(file));
}

export async function normalizedScipGraph({
  indexFile,
  converterVersion = 'unknown',
  graphSchemaVersion = 1,
  cache = new FileCache(),
  readIndex = ({ indexFile: file }) => readScipJson({ indexFile: file }),
} = {}) {
  if (!indexFile) throw new TypeError('indexFile required');

  const indexSha256 = await fileSha256(indexFile);
  const params = {
    indexSha256,
    converterVersion,
    graphSchemaVersion,
  };
  const key = cacheKey('scip-graph-v1', params);
  const hit = await cache.get('scip-graph-v1', key);
  if (hit) {
    return Object.freeze({
      cache: 'hit',
      indexSha256,
      graph: hit.graph,
      manifest: hit.manifest,
    });
  }

  const raw = await readIndex({ indexFile });
  const graph = buildSymbolGraph(raw);
  const manifest = {
    schemaVersion: 1,
    indexSha256,
    converterVersion,
    graphSchemaVersion,
    nodeCount: graph.nodeCount,
  };
  await cache.set('scip-graph-v1', key, { manifest, graph });

  return Object.freeze({
    cache: 'miss',
    indexSha256,
    graph,
    manifest,
  });
}
