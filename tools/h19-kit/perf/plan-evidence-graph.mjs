#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { FileCache } from '../src/core/cache.mjs';
import { planTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-plan.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const artifactRoot = path.resolve(cwd, arg('--artifact-root', '.h19/artifacts'));
const graphRoot = path.resolve(cwd, arg('--graph-root', '.h19/cache'));
const scipVersion = arg('--scip-version');
const decoderIdentity = arg('--decoder-id');
if (!scipVersion) throw new Error('--scip-version is required');
if (!decoderIdentity) throw new Error('--decoder-id is required');

const started = performance.now();
const plan = await planTypeScriptEvidenceGraph({
  cwd,
  artifactCache: new ArtifactCache(artifactRoot),
  graphCache: new FileCache(graphRoot),
  scipVersion,
  decoderIdentity,
});
const planningMs = Math.round((performance.now() - started) * 1000) / 1000;

const report = {
  schemaVersion: 1,
  kind: 'h19-production-evidence-plan',
  planningMs,
  index: {
    shardCount: plan.index.shardCount,
    hits: plan.index.hits,
    misses: plan.index.misses,
    missingShardIds: plan.index.missingShardIds,
  },
  graph: plan.graph,
  needsIndexer: plan.needsIndexer,
  needsDecoder: plan.needsDecoder,
  ready: plan.ready,
};
const json = `${JSON.stringify(report, null, 2)}\n`;

if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `index_hits=${plan.index.hits}`,
    `index_misses=${plan.index.misses}`,
    `graph_state=${plan.graph.state}`,
    `needs_indexer=${plan.needsIndexer}`,
    `needs_decoder=${plan.needsDecoder}`,
    `ready=${plan.ready}`,
    `planning_ms=${planningMs}`,
    '',
  ].join('\n'));
}
process.stdout.write(json);
