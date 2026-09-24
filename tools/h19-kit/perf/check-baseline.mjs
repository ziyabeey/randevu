#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluatePerformanceRegression } from '../src/perf/regression-gate.mjs';

const reportPath = process.argv[2];
const contractPath = process.argv[3]
  ?? new URL('./PERF_THRESHOLDS.v1.json', import.meta.url);

if (!reportPath) {
  throw new Error('usage: check-baseline.mjs <report.json> [contract.json]');
}

const report = JSON.parse(await readFile(path.resolve(reportPath), 'utf8'));
const contract = JSON.parse(await readFile(contractPath, 'utf8'));
const result = evaluatePerformanceRegression(report, contract);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.pass ? 0 : 1);
