import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (x) => createHash('sha256').update(String(x)).digest('hex');

export function freezeProtocol(protocol) {
  if (!protocol?.experiment_id || !protocol?.version) {
    throw new TypeError('protocol requires experiment_id and version');
  }
  const body = structuredClone(protocol);
  return Object.freeze({
    ...body,
    protocol_sha256: sha(`${stableJson(body)}\n`),
  });
}
