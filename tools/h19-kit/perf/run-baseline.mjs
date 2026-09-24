#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runPerformanceBaseline } from '../src/perf/baseline.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const requireScip = process.argv.includes('--require-scip');

const report = await runPerformanceBaseline({
  cwd,
  requireScip,
});

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);
