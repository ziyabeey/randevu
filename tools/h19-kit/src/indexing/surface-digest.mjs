import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

export function publicSurfaceDigest(graph) {
  const rows = (graph?.nodes ?? [])
    .filter((node) => (node.definitions?.length ?? 0) > 0)
    .map((node) => ({
      symbol: node.symbol,
      displayName: node.displayName ?? '',
      kind: node.kind ?? null,
      relationships: (node.relationships ?? [])
        .filter((rel) => rel.isImplementation || rel.isDefinition || rel.isTypeDefinition)
        .map((rel) => ({
          symbol: rel.symbol,
          isImplementation: Boolean(rel.isImplementation),
          isDefinition: Boolean(rel.isDefinition),
          isTypeDefinition: Boolean(rel.isTypeDefinition),
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return sha(stableJson(rows));
}
