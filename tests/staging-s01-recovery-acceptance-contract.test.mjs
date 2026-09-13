import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/staging.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/staging-s01-recovery-acceptance-runner.mjs', import.meta.url), 'utf8');
const deployment = readFileSync(new URL('../scripts/staging-deploy.mjs', import.meta.url), 'utf8');
const script = readFileSync(new URL('../scripts/staging-s01-recovery-acceptance.mjs', import.meta.url), 'utf8');

test('S01 public recovery acceptance is a dedicated opt-in workflow gate', () => {
  assert.equal(pkg.scripts['staging:s01-acceptance'], 'node scripts/staging-s01-recovery-acceptance-runner.mjs');
  assert.match(runner, /await import\('\.\/staging-s01-recovery-acceptance\.mjs'\)/);
  assert.match(runner, /max-age=0/i);
  assert.match(workflow, /run_s01_acceptance:/);
  assert.match(workflow, /s01_recovery_email:/);
  assert.match(workflow, /RESEND_ACCEPTANCE_API_KEY: \$\{\{ secrets\.RESEND_ACCEPTANCE_API_KEY \}\}/);
  assert.match(workflow, /S01_RECOVERY_EMAIL: \$\{\{ inputs\.s01_recovery_email \}\}/);
  assert.match(deployment, /if \(gates\.s01\) command\('npm', \['run', 'staging:s01-acceptance'\]\)/);

  const smokeIndex = deployment.indexOf("command('npm', ['run', 'staging:smoke'])");
  const acceptanceIndex = deployment.indexOf("command('npm', ['run', 'staging:s01-acceptance'])");
  assert.ok(smokeIndex >= 0 && acceptanceIndex > smokeIndex, 'S01 acceptance must run after base staging smoke');
});

test('S01 live gate exercises the public email and PKCE path instead of admin generate_link', () => {
  assert.match(script, /\/api\/auth\/recovery/);
  assert.match(script, /\/emails\/receiving\?limit=100/);
  assert.match(script, /\/emails\/receiving\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(script, /\/api\/auth\/callback/);
  assert.match(script, /yzt_auth_flows/);
  assert.doesNotMatch(script, /generate_link/);
});

test('S01 live gate keeps recovery authority through marker loss, refresh, second tab and replay', () => {
  assert.match(script, /recoveryJar\.delete\('yzt_password_recovery'\)/);
  assert.match(script, /const secondTab = new Map/);
  assert.match(script, /appRequest\(secondTab, '\/api\/availability\/setup'\)/);
  assert.doesNotMatch(script, /appRequest\(secondTab, '\/api\/availability'\)/);
  assert.match(script, /s01-expired-access-token/);
  assert.match(script, /invalid confirmation during recovery/);
  assert.match(script, /Replayed PKCE callback was not rejected/);
  assert.match(script, /old recovery bearer/i);
  assert.match(script, /\/api\/auth\/password/);
});

test('S01 mailbox credential stays acceptance-only', () => {
  assert.match(script, /RESEND_ACCEPTANCE_API_KEY/);
  assert.doesNotMatch(workflow, /payload\.RESEND_ACCEPTANCE_API_KEY/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(recoveryEmail|resendKey|adminKey)/);
  assert.doesNotMatch(runner, /RESEND_ACCEPTANCE_API_KEY|SUPABASE_ADMIN_KEY/);
});
