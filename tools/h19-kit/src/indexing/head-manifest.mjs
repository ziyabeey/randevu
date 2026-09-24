import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

export function createHeadIndexManifest({
  repository,
  head,
  base = null,
  projects = [],
  createdAt = null,
} = {}) {
  if (!repository || !head) throw new TypeError('repository/head required');

  const normalized = [...projects]
    .map((p) => ({
      projectRoot: p.projectRoot,
      fingerprint: p.fingerprint,
      indexer: p.indexer,
      publicSurface: p.publicSurface ?? null,
    }))
    .sort((a, b) => a.projectRoot.localeCompare(b.projectRoot));

  const body = {
    schemaVersion: 1,
    repository,
    base,
    head,
    projects: normalized,
  };

  return Object.freeze({
    ...body,
    createdAt,
    manifestDigest: sha(stableJson(body)),
  });
}
