#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { temporalCoupling } from '../src/adapters/git-history.mjs';
import { gitHotspots } from '../src/adapters/git-hotspots.mjs';
import { extractSqlRoutines } from '../src/extractors/sql-routines.mjs';
import { extractTypeScriptUnits } from '../src/extractors/typescript-units.mjs';
import { extractPythonUnits } from '../src/extractors/python-units.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';
import { scan } from '../src/pipeline/scan.mjs';
import { freezeCases } from '../src/experiments/freeze.mjs';
import { blindSample } from '../src/experiments/blind-sample.mjs';
import { compareH19BlindSpotLedgers, detectH19BlindSpots } from '../src/diagnostics/blind-spots.mjs';

const [command, ...args] = process.argv.slice(2);

function exists(cmd, cmdArgs = ['--version']) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore' });
  return r.status === 0;
}

if (command === 'doctor') {
  const report = {
    node: process.version,
    git: exists('git'),
    python: exists('python3') || exists('python'),
    semgrep: exists('semgrep'),
    note: 'Semgrep is optional. TypeScript parsing uses the toolkit-local official TS6 compatibility package.',
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.git ? 0 : 1);
}

if (command === 'history') {
  const cwd = args[0] ?? process.cwd();
  const rows = await temporalCoupling({ cwd });
  console.log(JSON.stringify(rows.slice(0, 100), null, 2));
  process.exit(0);
}

if (command === 'hotspots') {
  const cwd = args[0] ?? process.cwd();
  const rows = await gitHotspots({ cwd });
  console.log(JSON.stringify(rows.slice(0, 100), null, 2));
  process.exit(0);
}

if (command === 'units') {
  const file = args[0];
  if (!file) throw new Error('units requires a source file');
  const text = readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  const units = ext === '.sql'
    ? extractSqlRoutines(text, { path: file })
    : ext === '.py'
      ? await extractPythonUnits(text, { path: file })
      : ['.ts','.tsx','.js','.jsx','.mjs','.cjs'].includes(ext)
        ? extractTypeScriptUnits(text, { path: file })
        : (() => { throw new Error(`unsupported source extension: ${ext}`); })();
  console.log(JSON.stringify(units, null, 2));
  process.exit(0);
}

if (command === 'inventory') {
  const cwd = args[0] ?? process.cwd();
  const result = await repositoryInventory(cwd);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length ? 1 : 0);
}

if (command === 'blind-spots') {
  const file = args[0];
  if (!file) throw new Error('blind-spots requires <input.json>');
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const ledger = detectH19BlindSpots(input);
  console.log(JSON.stringify(ledger, null, 2));
  process.exit(0);
}

if (command === 'blind-spots-compare') {
  const [beforeFile, afterFile] = args;
  if (!beforeFile || !afterFile) {
    throw new Error('blind-spots-compare requires <before-ledger.json> <after-ledger.json>');
  }
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(readFileSync(afterFile, 'utf8'));
  console.log(JSON.stringify(compareH19BlindSpotLedgers(before, after), null, 2));
  process.exit(0);
}

if (command === 'experiment-freeze') {
  const [file, experimentId, protocolVersion] = args;
  if (!file || !experimentId || !protocolVersion) {
    throw new Error('experiment-freeze requires <cases.json> <experiment-id> <protocol-version>');
  }
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const cases = Array.isArray(input) ? input : input.cases;
  console.log(JSON.stringify(freezeCases(cases, { experimentId, protocolVersion }), null, 2));
  process.exit(0);
}

if (command === 'experiment-blind') {
  const [file, countRaw = '16'] = args;
  if (!file) throw new Error('experiment-blind requires <frozen.json> [count]');
  const frozen = JSON.parse(readFileSync(file, 'utf8'));
  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 1) throw new Error('blind sample count must be a positive integer');
  const sample = blindSample(frozen.cases, { seed: frozen.cases_sha256, count });
  console.log(JSON.stringify({
    seed: frozen.cases_sha256,
    count: sample.length,
    case_ids: sample.map((x) => x.case_id ?? x.id),
  }, null, 2));
  process.exit(0);
}

if (command === 'scan') {
  const file = args[0];
  if (!file) throw new Error('scan requires an input JSON file');
  const result = scan(JSON.parse(readFileSync(file, 'utf8')));
  const sarifOnly = args.includes('--sarif');
  console.log(JSON.stringify(sarifOnly ? result.sarif : result, null, 2));
  process.exit(0);
}

console.error([
  'usage: h19-kit <command>',
  '  doctor',
  '  inventory [repo]',
  '  units <file>',
  '  history [repo]',
  '  hotspots [repo]',
  '  scan <input.json> [--sarif]',
  '  blind-spots <input.json>',
  '  blind-spots-compare <before-ledger.json> <after-ledger.json>',
  '  experiment-freeze <cases.json> <experiment-id> <protocol-version>',
  '  experiment-blind <frozen.json> [count]',
].join('\n'));
process.exit(2);
