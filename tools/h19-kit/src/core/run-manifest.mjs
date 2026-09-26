import { createHash } from 'node:crypto';
import { stableJson } from './cache.mjs';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

export function createRunManifest({
  tool = { name: '@h19/kit', version: '0.0.1-alpha.0' },
  repository = {},
  config = {},
  adapters = [],
  units = [],
  startedAt = null,
} = {}) {
  const normalizedAdapters = [...adapters]
    .map((x) => ({
      id: x.id,
      kind: x.kind,
      version: x.version ?? 'unknown',
    }))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));

  const unitDigests = units.map((unit) => ({
    id: unit.id,
    digest: unit.digest ?? sha(stableJson(unit)),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const identityInput = {
    tool,
    repository: {
      remote: repository.remote ?? null,
      base: repository.base ?? null,
      head: repository.head ?? null,
    },
    config,
    adapters: normalizedAdapters,
    units: unitDigests,
  };

  return Object.freeze({
    schemaVersion: 1,
    runId: sha(stableJson(identityInput)),
    startedAt,
    tool,
    repository: identityInput.repository,
    configDigest: sha(stableJson(config)),
    adapters: normalizedAdapters,
    units: unitDigests,
  });
}
