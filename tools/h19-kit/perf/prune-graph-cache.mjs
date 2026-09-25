#!/usr/bin/env node
import path from 'node:path';

import { pruneGraphCache } from '../src/indexing/graph-cache-prune.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const report = await pruneGraphCache({
  root: path.resolve(arg('--root', '.h19/cache')),
  keep: Number(arg('--keep', '3')),
  maxBytes: Number(arg('--max-bytes', String(64 * 1024 * 1024))),
  dryRun: process.argv.includes('--dry-run'),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
