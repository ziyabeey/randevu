import { createHash } from 'node:crypto';

const digest = (x) => createHash('sha256').update(x).digest('hex');

export function normalizeBody(body) {
  return String(body ?? '')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function diffRoutineMaps(beforeMap, afterMap) {
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const units = [];

  for (const id of [...ids].sort()) {
    const before = beforeMap.get(id) ?? null;
    const after = afterMap.get(id) ?? null;
    if (!after) continue;
    const beforeNorm = normalizeBody(before?.body);
    const afterNorm = normalizeBody(after.body);
    if (before && beforeNorm === afterNorm) continue;

    units.push(Object.freeze({
      id,
      changeKind: before ? 'modified' : 'new',
      path: after.path,
      beforeDefinition: before?.definition ?? null,
      afterDefinition: after.definition,
      beforeBodySha256: before ? digest(beforeNorm) : null,
      afterBodySha256: digest(afterNorm),
    }));
  }

  return units;
}
