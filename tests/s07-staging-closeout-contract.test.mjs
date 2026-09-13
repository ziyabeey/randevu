import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deploy = readFileSync('scripts/staging-deploy.mjs', 'utf8');
const runner = readFileSync('scripts/staging-s07-acceptance.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/staging.yml', 'utf8');

await test('S07 C4 acceptance stays inside routine accept after F09/F10/S01', () => {
  assert.equal(pkg.scripts['staging:s07-acceptance'], 'node scripts/staging-s07-acceptance.mjs');
  assert.equal(
    pkg.scripts['staging:s01-acceptance'],
    'node scripts/staging-s01-recovery-acceptance-runner.mjs && npm run staging:s07-acceptance',
  );

  const smoke = deploy.indexOf("command('npm', ['run', 'staging:smoke'])");
  const f09 = deploy.indexOf("command('npm', ['run', 'staging:f09-acceptance'])");
  const f10 = deploy.indexOf("command('npm', ['run', 'staging:f10-auth-acceptance'])");
  const s01 = deploy.indexOf("command('npm', ['run', 'staging:s01-acceptance'])");
  assert.ok(smoke >= 0 && f09 > smoke && f10 > f09 && s01 > f10);
  assert.match(deploy, /if \(gates\.s01\) command\('npm', \['run', 'staging:s01-acceptance'\]\)/);
});

await test('S07 C4 runner has a fixed transactional SQL allowlist and generic failure output', () => {
  for (const file of [
    's07_terminal_pii_retention.sql',
    's07_list_pagination.sql',
    's07_snapshot_overflow.sql',
    's07_load_measurement.sql',
  ]) {
    assert.match(runner, new RegExp(file.replaceAll('.', '\\.')));
  }
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /PGCONNECT_TIMEOUT: '15'/);
  assert.match(runner, /timeout: 10 \* 60 \* 1000/);
  assert.match(runner, /S07 staging database acceptance failed/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*databaseUrl/);
});

await test('S07 C4 workflow exposes all three real gates and mailbox input', () => {
  assert.match(workflow, /run_f09_acceptance:/);
  assert.match(workflow, /run_f10_acceptance:/);
  assert.match(workflow, /run_s01_acceptance:/);
  assert.match(workflow, /s01_recovery_email:/);
  assert.match(workflow, /RUN_F09_ACCEPTANCE: \$\{\{ inputs\.run_f09_acceptance/);
  assert.match(workflow, /RUN_F10_ACCEPTANCE: \$\{\{ inputs\.run_f10_acceptance/);
  assert.match(workflow, /RUN_S01_ACCEPTANCE: \$\{\{ inputs\.run_s01_acceptance/);
  assert.match(workflow, /S01_RECOVERY_EMAIL: \$\{\{ inputs\.s01_recovery_email \}\}/);
});
