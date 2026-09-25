#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { ArtifactCache } from '../src/core/artifact-cache.mjs';
import { FileCache } from '../src/core/cache.mjs';
import { buildTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-graph.mjs';
import { planTypeScriptEvidenceGraph } from '../src/indexing/typescript-evidence-plan.mjs';
import {
  materializeTypeScriptShardPlan,
} from '../src/indexing/typescript-shard-plan.mjs';

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
const scipExecutable = arg('--scip', 'scip');
if (!scipVersion) throw new Error('--scip-version is required');
if (!decoderIdentity) throw new Error('--decoder-id is required');

const artifactCache = new ArtifactCache(artifactRoot);
const graphCache = new FileCache(graphRoot);

const initial = await planTypeScriptEvidenceGraph({
  cwd,
  artifactCache,
  graphCache,
  scipVersion,
  decoderIdentity,
});

let materialization = null;
if (initial.index.misses > 0) {
  materialization = await materializeTypeScriptShardPlan({
    cwd,
    plan: initial.index,
    cache: artifactCache,
  });
}

const started = performance.now();
const built = await buildTypeScriptEvidenceGraph({
  cwd,
  scipTypeScriptVersion: scipVersion,
  scipExecutable,
  decoderIdentity,
  artifactCache,
  graphCache,
});
const buildMs = Math.round((performance.now() - started) * 1000) / 1000;

const final = await planTypeScriptEvidenceGraph({
  cwd,
  artifactCache,
  graphCache,
  scipVersion,
  decoderIdentity,
});

if (!final.ready || final.index.misses !== 0 || final.graph.state !== 'hit') {
  throw new Error('H19 evidence graph did not converge to an all-hit state');
}

const report = {
  schemaVersion: 1,
  kind: 'h19-production-evidence-materialization',
  initial: {
    indexHits: initial.index.hits,
    indexMisses: initial.index.misses,
    graphState: initial.graph.state,
    needsIndexer: initial.needsIndexer,
    needsDecoder: initial.needsDecoder,
  },
  materialization: materialization ? {
    indexed: materialization.indexed,
    reused: materialization.reused,
  } : null,
  build: {
    wallMs: buildMs,
    mode: built.mode,
    indexHits: built.cache.indexHits,
    indexMisses: built.cache.indexMisses,
    graphCache: built.cache.graph,
    graphCacheKey: built.graphCacheKey,
    nodeCount: built.graph.nodeCount,
    documentCount: built.project?.documentCount ?? null,
  },
  final: {
    indexHits: final.index.hits,
    indexMisses: final.index.misses,
    graphState: final.graph.state,
    ready: final.ready,
  },
};
const json = `${JSON.stringify(report, null, 2)}\n`;

if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);
