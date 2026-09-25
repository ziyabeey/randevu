import { cacheKey } from '../core/cache.mjs';

export function typeScriptProjectGraphKey({
  decoderIdentity,
  graphSchemaVersion = 1,
  shards = [],
} = {}) {
  if (!decoderIdentity) throw new TypeError('decoderIdentity is required');
  const normalized = shards
    .map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      indexSha256: row.indexSha256,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (normalized.some((row) => !row.id || !row.fingerprint || !row.indexSha256)) {
    throw new TypeError('graph-key shards require id, fingerprint and indexSha256');
  }

  const input = {
    schemaVersion: 1,
    decoderIdentity,
    graphSchemaVersion,
    shards: normalized,
  };

  return Object.freeze({
    input: Object.freeze(input),
    key: cacheKey('ts-project-graph-v1', input),
  });
}
