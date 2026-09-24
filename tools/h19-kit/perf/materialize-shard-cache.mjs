#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import {
  materializeTypeScriptShardPlan,
  planTypeScriptShardIndexes,
} from '../src/indexing/typescript-shard-plan.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const cacheRoot = arg('--cache-root', '.h19/perf-shard-artifacts');
const scipVersion = arg('--scip-version');
if (!scipVersion) throw new Error('--scip-version is required');

const cache = new ArtifactCache(path.resolve(cwd, cacheRoot));
const plan = await planTypeScriptShardIndexes({
  cwd,
  cache,
  scipVersion,
});
const result = await materializeTypeScriptShardPlan({
  cwd,
  plan,
  cache,
});
const json = `${JSON.stringify({ plan: {
  shardCount: plan.shardCount,
  hits: plan.hits,
  misses: plan.misses,
  missingShardIds: plan.missingShardIds,
}, result }, null, 2)}\n`;

if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);
