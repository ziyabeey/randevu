#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { planTypeScriptShardIndexes } from '../src/indexing/typescript-shard-plan.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const cacheRoot = arg('--cache-root', '.h19/perf-shard-artifacts');
const scipVersion = arg('--scip-version');
if (!scipVersion) throw new Error('--scip-version is required');

const started = performance.now();
const plan = await planTypeScriptShardIndexes({
  cwd,
  cache: new ArtifactCache(path.resolve(cwd, cacheRoot)),
  scipVersion,
});
const planningMs = Math.round((performance.now() - started) * 1000) / 1000;

const report = {
  ...plan,
  planningMs,
  rows: plan.rows.map((row) => ({
    id: row.id,
    sourceFiles: row.sourceFiles.length,
    fingerprint: row.fingerprint,
    cache: row.cache,
    indexFile: row.indexFile,
  })),
};
const json = `${JSON.stringify(report, null, 2)}\n`;

if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT,
    `hits=${plan.hits}\nmisses=${plan.misses}\nall_hit=${plan.allHit}\nplanning_ms=${planningMs}\n`);
}
process.stdout.write(json);
