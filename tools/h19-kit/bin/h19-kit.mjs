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
import { scipGraph, scipImpact } from '../src/adapters/scip.mjs';
import { treeSitterTags } from '../src/adapters/tree-sitter-tags.mjs';
import { nxAffected } from '../src/adapters/nx-affected.mjs';
import { turboAffected } from '../src/adapters/turbo-affected.mjs';
import { indexTypeScriptScip } from '../src/adapters/scip-indexer.mjs';

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
    scip: exists('scip'),
    scipTypeScript: exists('scip-typescript'),
    treeSitter: exists('tree-sitter'),
    nx: exists('nx'),
    turbo: exists('turbo'),
    note: 'External analyzers are optional. Native toolkit extractors continue to work when they are absent.',
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

if (command === 'scip-index-ts') {
  const cwd = args[0] ?? process.cwd();
  const mode = args[1] ?? '';
  const result = await indexTypeScriptScip({
    cwd,
    inferTsconfig: mode === 'infer',
    pnpmWorkspaces: mode === 'pnpm',
    yarnWorkspaces: mode === 'yarn',
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (command === 'scip-impact') {
  const [indexPath, ...changedPaths] = args;
  if (!indexPath || changedPaths.length === 0) {
    throw new Error('scip-impact requires <index.scip> <changed-path>...');
  }
  const graph = await scipGraph({ indexPath });
  console.log(JSON.stringify(scipImpact(graph, changedPaths), null, 2));
  process.exit(0);
}

if (command === 'syntax-tags') {
  if (args.length === 0) throw new Error('syntax-tags requires <file>...');
  const graph = await treeSitterTags({ files: args });
  console.log(JSON.stringify(graph.toJSON(), null, 2));
  process.exit(0);
}

if (command === 'affected') {
  const [provider, base = 'main', head = 'HEAD', task = null] = args;
  if (provider === 'nx') {
    console.log(JSON.stringify(await nxAffected({ base, head }), null, 2));
    process.exit(0);
  }
  if (provider === 'turbo') {
    console.log(JSON.stringify(await turboAffected({ base, head, task }), null, 2));
    process.exit(0);
  }
  throw new Error('affected requires provider nx|turbo');
}

console.error([
  'usage: h19-kit <command>',
  '  doctor',
  '  inventory [repo]',
  '  units <file>',
  '  history [repo]',
  '  hotspots [repo]',
  '  scan <input.json> [--sarif]',
  '  scip-index-ts [repo] [infer|pnpm|yarn]',
  '  scip-impact <index.scip> <changed-path>...',
  '  syntax-tags <file>...',
  '  affected nx|turbo [base] [head] [task]',
  '  experiment-freeze <cases.json> <experiment-id> <protocol-version>',
  '  experiment-blind <frozen.json> [count]',
].join('\n'));
process.exit(2);
