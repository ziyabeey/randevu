#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runProjectShardAdoptionBenchmark } from '../src/perf/project-shard-adoption.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const scipExecutable = arg('--scip', 'scip');
const decoderIdentity = arg('--decoder-id');
const version = arg('--scip-typescript-version', '0.4.0');

if (!decoderIdentity) throw new Error('--decoder-id is required');

const report = await runProjectShardAdoptionBenchmark({
  cwd,
  scipExecutable,
  scipTypeScriptVersion: version,
  decoderIdentity,
});

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);
if (!report.pass) process.exit(1);
