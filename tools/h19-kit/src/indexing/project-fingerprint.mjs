import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stableJson } from '../core/cache.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');

async function digestFile(root, relativePath) {
  const buf = await readFile(path.join(root, relativePath));
  return {
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha(buf),
  };
}

export async function projectFingerprint({
  cwd = process.cwd(),
  projectRoot = '.',
  sourceFiles = [],
  configFiles = [],
  dependencySurfaces = {},
  indexer,
  adapterVersion = '0.1.0',
} = {}) {
  if (!indexer?.id || !indexer?.version) throw new TypeError('indexer id/version required');

  const root = path.resolve(cwd, projectRoot);
  const sources = await Promise.all([...new Set(sourceFiles)].sort().map((file) => digestFile(root, file)));
  const configs = await Promise.all([...new Set(configFiles)].sort().map((file) => digestFile(root, file)));

  const body = {
    schemaVersion: 1,
    projectRoot: projectRoot.replaceAll('\\', '/'),
    indexer: {
      id: indexer.id,
      version: indexer.version,
      flags: [...(indexer.flags ?? [])],
      projects: [...(indexer.projects ?? [])],
    },
    adapterVersion,
    sources,
    configs,
    dependencySurfaces: Object.fromEntries(
      Object.entries(dependencySurfaces).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };

  return Object.freeze({
    ...body,
    fingerprint: sha(Buffer.from(stableJson(body))),
  });
}
