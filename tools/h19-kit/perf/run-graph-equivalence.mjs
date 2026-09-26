#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runGraphEquivalence } from '../src/perf/graph-equivalence.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cwd = path.resolve(arg('--repo', process.cwd()));
const out = arg('--out');
const scipExecutable = arg('--scip', 'scip');
const scipTypeScriptVersion = arg('--scip-typescript-version', '0.4.0');

const report = await runGraphEquivalence({
  cwd,
  scipExecutable,
  scipTypeScriptVersion,
});

const json = `${JSON.stringify(report, null, 2)}\n`;
if (out) {
  const target = path.resolve(out);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
}
process.stdout.write(json);

if (!report.pass) process.exit(1);
