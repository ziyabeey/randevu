import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const stages = [
  { id: 'inventory', command: 'npm', args: ['run', 'test:ci-coverage'] },
  { id: 'audit' },
  { id: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { id: 'build', command: 'npm', args: ['run', 'build:ci'] },
  { id: 'public-bundle', command: 'npm', args: ['run', 'test:public-bundle'] },
  { id: 'browser', command: 'npm', args: ['run', 'test:browser-smoke'] },
  { id: 'worker', command: 'npx', args: ['wrangler', 'deploy', '--dry-run', '--outdir', '/tmp/randevu-worker'] },
  { id: 'http', command: 'npm', args: ['run', 'test:http'] },
  { id: 'staging-build', command: 'npm', args: ['run', 'build:staging:ci'] },
  { id: 'postgres', command: process.execPath, args: ['scripts/ci-postgres.mjs'] },
  { id: 'sql-connection', command: process.execPath, args: ['scripts/test-staging-control-db.mjs'] },
];

export function runCode({ root = process.cwd(), execute = spawnSync, selected = stages,
  output = process.env.GITHUB_OUTPUT, log = console.log } = {}) {
  if (JSON.stringify(selected.map((s) => s.id)) !== JSON.stringify(stages.map((s) => s.id))) {
    throw new Error('Required CI stage missing or out of order');
  }
  const options = { cwd: root, env: process.env, stdio: 'inherit', timeout: 15 * 60 * 1000 };
  const check = (result, id) => { if (result.error || result.status !== 0) throw new Error(`CI stage failed: ${id}`); };
  for (const stage of selected) {
    log(`::group::CI stage: ${stage.id}`);
    if (stage.id === 'audit') {
      const dir = mkdtempSync(path.join(tmpdir(), 'randevu-ci-audit-'));
      try {
        const result = execute('npm', ['audit', '--audit-level=high', '--json'], { ...options, stdio: 'pipe', encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const file = path.join(dir, 'audit.json');
        writeFileSync(file, result.stdout ?? '');
        check(execute(process.execPath, ['scripts/report-npm-audit.mjs', file], options), 'audit-report');
        check(result, 'audit');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    } else check(execute(stage.command, stage.args, options), stage.id);
    log('::endgroup::');
  }
  // Removing/skipping the workflow's runner step cannot produce this output.
  if (output) appendFileSync(output, 'complete=true\n');
  log(`Full CI completed ${stages.length} required stages.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runCode(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
