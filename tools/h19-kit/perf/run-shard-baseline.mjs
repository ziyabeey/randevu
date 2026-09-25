#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runTypeScriptShardBenchmark } from '../src/perf/typescript-shards.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const version = arg('--scip-version', '0.4.0');
const persistentCacheRoot = arg('--cache-root');

const report = await runTypeScriptShardBenchmark({
  cwd,
  version,
  persistentCacheRoot: persistentCacheRoot ? path.resolve(persistentCacheRoot) : null,
});
const json = `${JSON.stringify(report, null, 2)}\n`;

if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}

process.stdout.write(json);
