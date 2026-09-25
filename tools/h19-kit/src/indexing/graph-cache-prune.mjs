import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export async function inspectGraphCache({
  root = '.h19/cache',
  namespace = 'ts-project-graph-v1',
} = {}) {
  const dir = path.join(root, namespace);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(dir, entry.name);
    const info = await stat(file);
    rows.push({
      key: entry.name.slice(0, -'.json'.length),
      file,
      bytes: info.size,
      mtimeMs: info.mtimeMs,
    });
  }

  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs || a.key.localeCompare(b.key));
}

export async function pruneGraphCache({
  root = '.h19/cache',
  namespace = 'ts-project-graph-v1',
  keep = 3,
  maxBytes = 64 * 1024 * 1024,
  dryRun = false,
} = {}) {
  if (!Number.isInteger(keep) || keep < 1) throw new TypeError('keep must be an integer >= 1');
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be >= 1');

  const rows = await inspectGraphCache({ root, namespace });
  const remove = new Set(rows.slice(keep).map((row) => row.key));

  let retained = rows.filter((row) => !remove.has(row.key));
  let retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);

  for (const row of [...retained].sort((a, b) => a.mtimeMs - b.mtimeMs || a.key.localeCompare(b.key))) {
    if (retainedBytes <= maxBytes) break;
    if (retained.filter((candidate) => !remove.has(candidate.key)).length <= 1) break;
    if (remove.has(row.key)) continue;
    remove.add(row.key);
    retainedBytes -= row.bytes;
  }

  const removed = rows.filter((row) => remove.has(row.key));
  if (!dryRun) {
    for (const row of removed) await rm(row.file, { force: true });
  }

  retained = rows.filter((row) => !remove.has(row.key));
  retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);

  return Object.freeze({
    schemaVersion: 1,
    namespace,
    beforeEntries: rows.length,
    beforeBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    removedEntries: removed.length,
    removedBytes: removed.reduce((sum, row) => sum + row.bytes, 0),
    afterEntries: retained.length,
    afterBytes: retainedBytes,
    keep,
    maxBytes,
    overBudgetUnavoidable: retainedBytes > maxBytes,
    removedKeys: Object.freeze(removed.map((row) => row.key).sort()),
    dryRun,
  });
}
