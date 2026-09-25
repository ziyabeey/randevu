#!/usr/bin/env node
import path from 'node:path';

import { pruneScipArtifactCache } from '../src/indexing/cache-prune.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const root = path.resolve(arg('--root', '.h19/artifacts'));
const keepPerShard = Number(arg('--keep-per-shard', '3'));
const maxBytes = Number(arg('--max-bytes', String(256 * 1024 * 1024)));
const dryRun = process.argv.includes('--dry-run');

const report = await pruneScipArtifactCache({
  root,
  keepPerShard,
  maxBytes,
  dryRun,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
