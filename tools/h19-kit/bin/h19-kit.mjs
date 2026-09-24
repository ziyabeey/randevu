#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { temporalCoupling } from '../src/adapters/git-history.mjs';
import { gitHotspots } from '../src/adapters/git-hotspots.mjs';
import { extractSqlRoutines } from '../src/extractors/sql-routines.mjs';
import { extractTypeScriptUnits } from '../src/extractors/typescript-units.mjs';
import { extractPythonUnits } from '../src/extractors/python-units.mjs';
import { scan } from '../src/pipeline/scan.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';

const [command, ...args] = process.argv.slice(2);

function exists(cmd, cmdArgs = ['--version']) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore' });
  return r.status === 0;
}

if (command === 'doctor') {
  const report = {
    node: process.version,
    git: exists('git'),
    semgrep: exists('semgrep'),
    note: 'Semgrep is optional. No third-party analyzer is bundled.',
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

if (command === 'scan') {
  const file = args[0];
  if (!file) throw new Error('scan requires an input JSON file');
  const result = scan(JSON.parse(readFileSync(file, 'utf8')));
  const sarifOnly = args.includes('--sarif');
  console.log(JSON.stringify(sarifOnly ? result.sarif : result, null, 2));
  process.exit(0);
}

console.error('usage: h19-kit <doctor|inventory [repo]|history [repo]|hotspots [repo]|units <file>|scan <input.json> [--sarif]>');
process.exit(2);
