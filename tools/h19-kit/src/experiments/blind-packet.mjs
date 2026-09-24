import { createHash } from 'node:crypto';
import { stableJson } from '../core/cache.mjs';

const sha = (x) => createHash('sha256').update(String(x)).digest('hex');

function omitKeys(value, blocked) {
  if (Array.isArray(value)) return value.map((x) => omitKeys(x, blocked));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !blocked.has(key))
        .map(([key, item]) => [key, omitKeys(item, blocked)]),
    );
  }
  return value;
}

export function createBlindPacket(cases, {
  hiddenKeys = ['label', 'd5', 'axes', 'layer', 'direction', 'rationale', 'expected'],
  packetId = 'blind',
  metadata = {},
} = {}) {
  const blocked = new Set(hiddenKeys);
  const rows = cases.map((item, index) => ({
    no: index + 1,
    case: omitKeys(structuredClone(item), blocked),
  }));
  const body = {
    schema_version: 1,
    packet_id: packetId,
    metadata: structuredClone(metadata),
    hidden_keys: [...blocked].sort(),
    cases: rows,
  };
  return Object.freeze({
    ...body,
    packet_sha256: sha(`${stableJson(body)}\n`),
  });
}

export function createBlindKey(cases, {
  answer = (item) => item.label ?? item.expected ?? null,
  packetId = 'blind',
} = {}) {
  const rows = cases.map((item, index) => ({
    no: index + 1,
    case_id: item.case_id ?? item.id,
    answer: answer(item),
  }));
  const body = { schema_version: 1, packet_id: packetId, answers: rows };
  return Object.freeze({
    ...body,
    key_sha256: sha(`${stableJson(body)}\n`),
  });
}
