import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { stableJson } from '../core/cache.mjs';

async function dirSize(root) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

function identity(manifest = {}) {
  return stableJson({
    projectRoot: manifest.projectRoot ?? null,
    indexer: {
      id: manifest.indexer?.id ?? null,
      version: manifest.indexer?.version ?? null,
      flags: manifest.indexer?.flags ?? [],
    },
  });
}

export async function inspectScipArtifactCache({
  root = '.h19/artifacts',
} = {}) {
  const namespaceRoot = path.join(root, 'scip-project-v1');
  let dirs;
  try {
    dirs = await readdir(namespaceRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const rows = [];
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(namespaceRoot, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const info = await stat(dir);
    const createdAtMs = Number.isFinite(Date.parse(manifest.createdAt ?? ''))
      ? Date.parse(manifest.createdAt)
      : info.mtimeMs;
    rows.push({
      key: entry.name,
      dir,
      identity: identity(manifest),
      createdAt: manifest.createdAt ?? null,
      createdAtMs,
      bytes: await dirSize(dir),
      manifest,
    });
  }

  return rows.sort((a, b) => b.createdAtMs - a.createdAtMs || a.key.localeCompare(b.key));
}

export async function pruneScipArtifactCache({
  root = '.h19/artifacts',
  keepPerShard = 3,
  maxBytes = 256 * 1024 * 1024,
  dryRun = false,
} = {}) {
  if (!Number.isInteger(keepPerShard) || keepPerShard < 1) {
    throw new TypeError('keepPerShard must be an integer >= 1');
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be >= 1');
  }

  const rows = await inspectScipArtifactCache({ root });
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.identity)) groups.set(row.identity, []);
    groups.get(row.identity).push(row);
  }

  const remove = new Set();
  for (const group of groups.values()) {
    group.sort((a, b) => b.createdAtMs - a.createdAtMs || a.key.localeCompare(b.key));
    for (const row of group.slice(keepPerShard)) remove.add(row.key);
  }

  let retained = rows.filter((row) => !remove.has(row.key));
  let retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);

  // Global pressure may evict older extra generations, but never the newest
  // generation for any logical shard.
  const counts = new Map();
  for (const row of retained) counts.set(row.identity, (counts.get(row.identity) ?? 0) + 1);
  const oldest = [...retained].sort((a, b) => a.createdAtMs - b.createdAtMs || a.key.localeCompare(b.key));
  for (const row of oldest) {
    if (retainedBytes <= maxBytes) break;
    if ((counts.get(row.identity) ?? 0) <= 1) continue;
    remove.add(row.key);
    counts.set(row.identity, counts.get(row.identity) - 1);
    retainedBytes -= row.bytes;
  }

  const removed = rows.filter((row) => remove.has(row.key));
  if (!dryRun) {
    for (const row of removed) await rm(row.dir, { recursive: true, force: true });
  }

  retained = rows.filter((row) => !remove.has(row.key));
  retainedBytes = retained.reduce((sum, row) => sum + row.bytes, 0);

  return Object.freeze({
    schemaVersion: 1,
    beforeEntries: rows.length,
    beforeBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    removedEntries: removed.length,
    removedBytes: removed.reduce((sum, row) => sum + row.bytes, 0),
    afterEntries: retained.length,
    afterBytes: retainedBytes,
    logicalShards: groups.size,
    keepPerShard,
    maxBytes,
    overBudgetUnavoidable: retainedBytes > maxBytes,
    removedKeys: Object.freeze(removed.map((row) => row.key).sort()),
    dryRun,
  });
}
