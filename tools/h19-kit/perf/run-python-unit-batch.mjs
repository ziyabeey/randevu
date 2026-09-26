#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  extractPythonUnits,
  extractPythonUnitsBatch,
} from '../src/extractors/python-units.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const repoRoot = path.resolve(arg('--repo') ?? '');
const outPath = path.resolve(arg('--out') ?? '');
const iterations = Number(arg('--iterations') ?? 5);
if (!arg('--repo') || !arg('--out') || !Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
  throw new Error('usage: run-python-unit-batch.mjs --repo REPO --out REPORT.json [--iterations N]');
}

async function walk(current, root = current, out = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (['.git', '.h19', 'node_modules', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(full, root, out);
    else if (entry.isFile() && entry.name.endsWith('.py')) {
      out.push(path.relative(root, full).replaceAll('\\', '/'));
    }
  }
  return out;
}

const files = (await walk(repoRoot)).sort();
const inputs = await Promise.all(files.map(async (file) => ({
  path: file,
  text: await readFile(path.join(repoRoot, file), 'utf8'),
})));

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedRows(results) {
  return results
    .map((row) => ({ path: row.path, units: row.units }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function runSingles() {
  const started = performance.now();
  const results = [];
  for (const file of inputs) {
    results.push({
      path: file.path,
      units: await extractPythonUnits(file.text, { path: file.path }),
    });
  }
  return {
    wallMs: performance.now() - started,
    results: normalizedRows(results),
  };
}

async function runBatch() {
  const started = performance.now();
  const result = await extractPythonUnitsBatch(inputs);
  if (result.errors.length) {
    throw new Error(`batch extraction returned ${result.errors.length} file errors`);
  }
  return {
    wallMs: performance.now() - started,
    results: normalizedRows(result.results),
  };
}

const warmSingle = await runSingles();
const warmBatch = await runBatch();
if (digest(warmSingle.results) !== digest(warmBatch.results)) {
  throw new Error('single/batch warmup outputs differ');
}

const cycles = [];
for (let i = 0; i < iterations; i += 1) {
  const singleFirst = i % 2 === 0;
  const first = singleFirst ? await runSingles() : await runBatch();
  const second = singleFirst ? await runBatch() : await runSingles();
  const single = singleFirst ? first : second;
  const batch = singleFirst ? second : first;
  const singleDigest = digest(single.results);
  const batchDigest = digest(batch.results);
  if (singleDigest !== batchDigest) {
    throw new Error(`single/batch output mismatch in cycle ${i + 1}`);
  }
  cycles.push({
    cycle: i + 1,
    order: singleFirst ? ['single', 'batch'] : ['batch', 'single'],
    singleMs: single.wallMs,
    batchMs: batch.wallMs,
    outputDigest: singleDigest,
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const singleValues = cycles.map((row) => row.singleMs);
const batchValues = cycles.map((row) => row.batchMs);
const singleMedian = median(singleValues);
const batchMedian = median(batchValues);
const report = {
  schemaVersion: 1,
  kind: 'h19-python-semantic-extraction-batch-benchmark',
  files: files.length,
  semanticUnits: warmBatch.results.reduce((sum, row) => sum + row.units.length, 0),
  iterations,
  warmup: {
    singleMs: warmSingle.wallMs,
    batchMs: warmBatch.wallMs,
    outputsEqual: true,
  },
  cycles,
  summary: {
    singleMedianMs: singleMedian,
    batchMedianMs: batchMedian,
    medianSpeedup: batchMedian > 0 ? singleMedian / batchMedian : null,
    singleRangeMs: [Math.min(...singleValues), Math.max(...singleValues)],
    batchRangeMs: [Math.min(...batchValues), Math.max(...batchValues)],
    outputDigest: cycles[0]?.outputDigest ?? digest(warmBatch.results),
    outputsEqual: true,
  },
  processModel: {
    singleInterpreterStartsPerCycle: files.length,
    batchInterpreterStartsPerCycle: files.length ? 1 : 0,
  },
  limits: [
    'This is a paired microbenchmark of semantic extraction only, not end-to-end H19 latency.',
    'One warmup is excluded from the measured cycles.',
    'Five default paired cycles are too small for stable tail-latency claims; median and range are reported.',
    'The benchmark requires output identity between single-file and batch extraction in every cycle.',
  ],
};

await writeFile(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
