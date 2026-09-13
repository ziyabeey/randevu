import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deploy = readFileSync('scripts/staging-deploy.mjs', 'utf8');
const runner = readFileSync('scripts/staging-s07-acceptance.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/staging.yml', 'utf8');

await test('S07 C4 acceptance is a routine triple-gate step after F09/F10/S01', () => {
  assert.equal(pkg.scripts['staging:s07-acceptance'], 'node scripts/staging-s07-acceptance.mjs');
  assert.equal(pkg.scripts['staging:s01-acceptance'], 'node scripts/staging-s01-recovery-acceptance-runner.mjs');

  const smoke = deploy.indexOf("command('npm', ['run', 'staging:smoke'])");
  const f09 = deploy.indexOf("command('npm', ['run', 'staging:f09-acceptance'])");
  const f10 = deploy.indexOf("command('npm', ['run', 'staging:f10-auth-acceptance'])");
  const s01 = deploy.indexOf("command('npm', ['run', 'staging:s01-acceptance'])");
  const s07 = deploy.indexOf("command('npm', ['run', 'staging:s07-acceptance'])");
  assert.ok(smoke >= 0 && f09 > smoke && f10 > f09 && s01 > f10 && s07 > s01);
  assert.match(deploy, /if \(mode === 'deploy' && gates\.f09 && gates\.f10 && gates\.s01\) \{/);
  assert.match(deploy, /const readback = database\(\)/);
  assert.match(deploy, /if \(readback\.pending \|\| readback\.fixtures !== 2\)/);
  assert.match(deploy, /const active = await cloudState\(\)/);
  assert.match(deploy, /if \(active\.version !== state\.target\)/);
  assert.match(deploy, /S07 C4 staging readback passed/);
});

await test('S07 C4 runner has a fixed SQL allowlist, bounded psql and redacted failure output', () => {
  for (const file of [
    's07_terminal_pii_retention.sql',
    's07_list_pagination.sql',
    's07_snapshot_overflow.sql',
    's07_load_measurement.sql',
  ]) {
    assert.equal(runner.split(file).length - 1, 1, `${file} must appear exactly once in the fixed allowlist`);
  }
  assert.match(runner, /spawnSync\('psql'/);
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /VERBOSITY=terse/);
  assert.match(runner, /PGCONNECT_TIMEOUT: '15'/);
  assert.match(runner, /stdio: \['ignore', 'pipe', 'pipe'\]/);
  assert.match(runner, /timeout: 10 \* 60 \* 1000/);
  assert.match(runner, /maxBuffer: 4 \* 1024 \* 1024/);
  assert.match(runner, /S07 staging database acceptance failed/);
  assert.doesNotMatch(runner, /stdio: 'inherit'/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*databaseUrl/);
  assert.match(runner, /metrics\.length !== 2/);
  assert.match(runner, /workload=catalog_snapshot/);
  assert.match(runner, /workload=booking_page/);
  assert.match(runner, /errors=0/);
});

await test('S07 C4 uses the existing three real workflow gates and mailbox input', () => {
  assert.match(workflow, /run_f09_acceptance:/);
  assert.match(workflow, /run_f10_auth_acceptance:/);
  assert.match(workflow, /run_s01_acceptance:/);
  assert.match(workflow, /s01_recovery_email:/);
  assert.match(workflow, /RUN_F09_ACCEPTANCE: \$\{\{ inputs\.run_f09_acceptance/);
  assert.match(workflow, /RUN_F10_ACCEPTANCE: \$\{\{ inputs\.run_f10_auth_acceptance \}\}/);
  assert.match(workflow, /RUN_S01_ACCEPTANCE: \$\{\{ inputs\.run_s01_acceptance \}\}/);
  assert.match(workflow, /S01_RECOVERY_EMAIL: \$\{\{ inputs\.s01_recovery_email \}\}/);
});
