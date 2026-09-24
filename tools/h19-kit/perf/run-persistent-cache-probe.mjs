#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runPersistentShardCacheProbe } from '../src/perf/persistent-shard-cache.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const cacheRoot = arg('--cache-root', '.h19/perf-shard-artifacts');
const scipVersion = arg('--scip-version', '0.4.0');

const report = await runPersistentShardCacheProbe({
  cwd,
  cacheRoot,
  scipVersion,
});

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);
