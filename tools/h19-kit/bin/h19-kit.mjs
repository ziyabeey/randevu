#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { temporalCoupling } from '../src/adapters/git-history.mjs';

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

console.error('usage: h19-kit <doctor|history [repo]>');
process.exit(2);
